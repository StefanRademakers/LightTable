import { describe, expect, it, vi } from 'vitest';
import type { DocumentFontAsset } from '../../editor/document/documentTypes';
import {
  DocumentFontRegistry,
  fingerprintFontBytes,
  type FontFaceParser,
  type FontRegistration
} from './DocumentFontRegistry';

const registration = (
  assetId: string,
  family: string,
  overrides: Partial<FontRegistration> = {}
): FontRegistration => ({
  assetId,
  faceIndex: 0,
  source: 'document',
  container: 'sfnt',
  outline: 'truetype',
  postScriptName: `${family.replaceAll(' ', '')}-Regular`,
  embedding: { level: 'editable', noSubsetting: false, bitmapOnly: false },
  familyNames: [family],
  styleName: 'Regular',
  weight: 400,
  stretch: 100,
  italic: false,
  ...overrides
});

const setup = (overrides: Partial<ConstructorParameters<typeof DocumentFontRegistry>[0]> = {}) => {
  const face = { glyphCount: 42, unitsPerEm: 1_000, dispose: vi.fn() };
  const parser: FontFaceParser = { parse: vi.fn(async () => face) };
  const registry = new DocumentFontRegistry({ parser, ...overrides });
  return { registry, parser, face };
};

describe('DocumentFontRegistry', () => {
  it('deduplicates immutable bytes by fingerprint while retaining distinct faces', async () => {
    const { registry } = setup();
    const bytes = new Uint8Array([0, 1, 2, 3, 4]);
    const first = await registry.registerBytes(bytes, registration('face-a', 'Fixture Sans'));
    const second = await registry.registerBytes(bytes, registration('face-b', 'Fixture Sans', {
      faceIndex: 1,
      styleName: 'Bold',
      weight: 700
    }));
    bytes[0] = 255;

    expect(first.fingerprintSha256).toBe(second.fingerprintSha256);
    expect(registry.byteSize).toBe(5);
    const returned = await registry.bytes(first.assetId);
    returned![0] = 99;
    expect(await registry.bytes(first.assetId)).toEqual(new Uint8Array([0, 1, 2, 3, 4]));
    expect(registry.assets).toHaveLength(2);
  });

  it('deduplicates parsing aliases by fingerprint and face index', async () => {
    const { registry, parser } = setup();
    const bytes = new Uint8Array([4, 3, 2, 1]);
    const first = await registry.registerBytes(bytes, registration('alias-a', 'Alias'));
    const second = await registry.registerBytes(bytes, registration('alias-b', 'Alias'));

    await Promise.all([registry.parse(first.assetId), registry.parse(second.assetId)]);
    expect(parser.parse).toHaveBeenCalledOnce();
  });

  it('parses lazily once, accounts bytes and disposes parsed resources', async () => {
    const { registry, parser, face } = setup();
    const asset = await registry.registerBytes(
      new Uint8Array([1, 2, 3]),
      registration('lazy', 'Lazy Font')
    );

    expect(parser.parse).not.toHaveBeenCalled();
    const [left, right] = await Promise.all([registry.parse(asset.assetId), registry.parse(asset.assetId)]);
    expect(left).toBe(right);
    expect(parser.parse).toHaveBeenCalledOnce();

    registry.dispose();
    expect(face.dispose).toHaveBeenCalledOnce();
    expect(() => registry.resolve({ families: ['Lazy Font'] }, {
      weight: 400, stretch: 100, italic: false
    })).toThrow(/disposed/);
  });

  it('resolves preferred, PostScript and family faces with deterministic style scoring', async () => {
    const { registry } = setup();
    const regular = await registry.registerBytes(
      new Uint8Array([1]),
      registration('regular', 'Fixture Sans')
    );
    const bold = await registry.registerBytes(
      new Uint8Array([2]),
      registration('bold', 'Fixture Sans', { weight: 700, styleName: 'Bold' })
    );

    expect(registry.resolve({ families: ['Fixture Sans'] }, {
      weight: 650, stretch: 100, italic: false
    })).toMatchObject({ kind: 'exact', asset: { assetId: bold.assetId }, matchedBy: 'family' });
    expect(registry.resolve({ families: ['Missing'], postScriptName: regular.postScriptName }, {
      weight: 400, stretch: 100, italic: false
    })).toMatchObject({ kind: 'exact', asset: { assetId: regular.assetId }, matchedBy: 'postscript-name' });
    expect(registry.resolve({
      families: ['Missing'],
      preferredAsset: regular
    }, { weight: 700, stretch: 100, italic: false })).toMatchObject({
      kind: 'exact', asset: { assetId: regular.assetId }, matchedBy: 'preferred-asset'
    });
  });

  it('reports explicit substitution or missing results and never silently falls back', async () => {
    const { registry } = setup();
    await registry.registerBytes(
      new Uint8Array([9]),
      registration('fallback', 'Explicit Fallback')
    );

    expect(registry.resolve({ families: ['Unavailable'] }, {
      weight: 400, stretch: 100, italic: false
    })).toEqual({ kind: 'missing', requestedFamilies: ['Unavailable'] });
    expect(registry.resolve({ families: ['Unavailable'] }, {
      weight: 400, stretch: 100, italic: false
    }, ['Explicit Fallback'])).toMatchObject({
      kind: 'substituted',
      asset: { assetId: 'fallback' },
      substituteFamily: 'Explicit Fallback'
    });
  });

  it('loads optional system bytes lazily and rejects changed or oversized data', async () => {
    const bytes = new Uint8Array([7, 8, 9]);
    const fingerprint = await fingerprintFontBytes(bytes);
    const systemAsset: DocumentFontAsset = {
      ...registration('system', 'System Fixture', { source: 'system' }),
      fingerprintSha256: fingerprint,
      byteLength: bytes.byteLength
    };
    const provider = { load: vi.fn(async () => bytes) };
    const { registry } = setup({ systemProvider: provider, maxFontBytes: 4, maxTotalBytes: 4 });
    const availabilityChanged = vi.fn();
    registry.subscribeAvailability(availabilityChanged);
    registry.registerReference(systemAsset);

    expect(registry.resolve({ families: ['System Fixture'] }, {
      weight: 400, stretch: 100, italic: false
    }).kind).toBe('exact');
    expect(provider.load).not.toHaveBeenCalled();

    expect(await registry.bytes(systemAsset.assetId)).toEqual(bytes);
    expect(registry.resolve({ families: ['System Fixture'] }, {
      weight: 400, stretch: 100, italic: false
    }).kind).toBe('exact');
    expect(provider.load).toHaveBeenCalledOnce();
    expect(availabilityChanged).toHaveBeenCalledTimes(2);
    expect(await registry.materializeBytes()).toEqual([{ fingerprintSha256: fingerprint, bytes }]);
    await expect(registry.registerBytes(
      new Uint8Array(5),
      registration('too-large', 'Too Large')
    )).rejects.toThrow(/between 1 and 4/);
  });

  it('does not count lazy system catalog references against the portable face limit', async () => {
    const { registry } = setup({ systemProvider: { load: async () => null } });
    registry.registerReferences(Array.from({ length: 300 }, (_, index): DocumentFontAsset => ({
      ...registration(`system-${index}`, `System Family ${index}`, { source: 'system' }),
      fingerprintSha256: index.toString(16).padStart(64, '0'),
      byteLength: 1
    })));

    const bundled = await registry.registerBytes(
      new Uint8Array([1, 2, 3]),
      registration('bundled-default', 'Bundled Default', { source: 'bundled' })
    );

    expect(bundled.source).toBe('bundled');
    expect(registry.assets).toHaveLength(301);
    expect(registry.byteSize).toBe(3);
  });

  it('keeps registration atomic when total byte limits reject a font', async () => {
    const { registry } = setup({ maxTotalBytes: 4 });
    await registry.registerBytes(new Uint8Array([1, 2, 3]), registration('kept', 'Kept'));

    await expect(registry.registerBytes(
      new Uint8Array([4, 5]),
      registration('rejected', 'Rejected')
    )).rejects.toThrow(/exceed/);
    expect(registry.assets.map(({ assetId }) => assetId)).toEqual(['kept']);
    expect(registry.byteSize).toBe(3);
  });

  it('refuses to embed restricted system fonts in portable documents', async () => {
    const bytes = new Uint8Array([5, 4, 3]);
    const fingerprintSha256 = await fingerprintFontBytes(bytes);
    const { registry } = setup({ systemProvider: { load: async () => bytes } });
    registry.registerReference({
      ...registration('restricted', 'Restricted', { source: 'system' }),
      fingerprintSha256,
      byteLength: bytes.byteLength,
      embedding: { level: 'restricted', noSubsetting: false, bitmapOnly: false }
    });

    await expect(registry.materializeBytes()).rejects.toThrow(/does not permit/);
  });

  it('disposes a parser result that completes after registry teardown', async () => {
    const lateFace = { glyphCount: 10, unitsPerEm: 1_000, dispose: vi.fn() };
    const deferred: { resolve?: (face: typeof lateFace) => void } = {};
    const parser = {
      parse: vi.fn(() => new Promise<typeof lateFace>((resolve) => {
        deferred.resolve = (face) => resolve(face);
      }))
    };
    const registry = new DocumentFontRegistry({ parser });
    const asset = await registry.registerBytes(
      new Uint8Array([1, 2, 3]),
      registration('late', 'Late')
    );
    const pending = registry.parse(asset.assetId);
    await Promise.resolve();
    registry.dispose();
    if (!deferred.resolve) throw new Error('Parser did not start.');
    deferred.resolve(lateFace);

    await expect(pending).rejects.toThrow(/disposed/);
    expect(lateFace.dispose).toHaveBeenCalledOnce();
  });
});
