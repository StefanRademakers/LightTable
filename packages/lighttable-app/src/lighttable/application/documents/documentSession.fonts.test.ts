import { describe, expect, it, vi } from 'vitest';
import { createImageDocument } from '../../editor/document/documentTypes';
import { fingerprintFontBytes } from '../../text/fonts/DocumentFontRegistry';
import { DocumentSession, type DocumentSessionId } from './documentSession';

describe('DocumentSession font lifecycle', () => {
  it('registers canonical font references and disposes its registry with the session', () => {
    const session = new DocumentSession({
      id: 'font-session' as DocumentSessionId,
      source: { id: 'source', name: 'fonts.lighttable.png', mediaType: 'image/png' }
    });
    const document = createImageDocument('Fonts', 10, 10, 'source');
    document.assets.fonts.push({
      assetId: 'font',
      faceIndex: 0,
      fingerprintSha256: 'a'.repeat(64),
      source: 'document',
      container: 'sfnt',
      outline: 'truetype',
      embedding: { level: 'editable', noSubsetting: false, bitmapOnly: false },
      familyNames: ['Fixture'],
      styleName: 'Regular',
      weight: 400,
      stretch: 100,
      italic: false,
      byteLength: 4
    });

    session.setDocument(document);
    expect(session.fonts.assets).toHaveLength(1);
    session.dispose();

    expect(() => session.fonts.resolve({ families: ['Fixture'] }, {
      weight: 400, stretch: 100, italic: false
    })).toThrow(/disposed/);
  });

  it('materializes host-provided system bytes for portable native saves', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fingerprintSha256 = await fingerprintFontBytes(bytes);
    const load = vi.fn(async () => bytes);
    const session = new DocumentSession({
      id: 'system-font-session' as DocumentSessionId,
      source: { id: 'source', name: 'system.lighttable.png', mediaType: 'image/png' },
      systemFontProvider: { load }
    });
    session.fonts.registerReference({
      assetId: 'system-font', faceIndex: 0, fingerprintSha256, source: 'system',
      container: 'sfnt', outline: 'truetype',
      embedding: { level: 'editable', noSubsetting: false, bitmapOnly: false },
      familyNames: ['System Fixture'], styleName: 'Regular', weight: 400,
      stretch: 100, italic: false, byteLength: bytes.byteLength
    });

    expect(await session.fonts.materializeBytes()).toEqual([{ fingerprintSha256, bytes }]);
    expect(load).toHaveBeenCalledOnce();
    session.dispose();
  });
});
