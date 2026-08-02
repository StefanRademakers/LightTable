import type { RequestedFont } from '@lighttable/text-core';
import type { DocumentFontAsset } from '../../editor/document/documentTypes';

const DEFAULT_MAX_FONT_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 256 * 1024 * 1024;

export interface ParsedFontFace {
  readonly glyphCount: number;
  readonly unitsPerEm: number;
  dispose?(): void;
}

export interface FontFaceParser {
  parse(bytes: Uint8Array, asset: DocumentFontAsset): Promise<ParsedFontFace>;
}

export interface SystemFontByteProvider {
  load(asset: DocumentFontAsset): Promise<Uint8Array | null>;
}

export interface DocumentFontRegistryOptions {
  readonly parser: FontFaceParser;
  readonly systemProvider?: SystemFontByteProvider;
  readonly maxFontBytes?: number;
  readonly maxTotalBytes?: number;
}

export type FontRegistration = Omit<
  DocumentFontAsset,
  'fingerprintSha256' | 'byteLength'
> & {
  readonly fingerprintSha256?: string;
};

export type FontResolution =
  | {
      readonly kind: 'exact';
      readonly asset: DocumentFontAsset;
      readonly matchedBy: 'preferred-asset' | 'postscript-name' | 'family';
    }
  | {
      readonly kind: 'substituted';
      readonly asset: DocumentFontAsset;
      readonly requestedFamilies: readonly string[];
      readonly substituteFamily: string;
    }
  | {
      readonly kind: 'missing';
      readonly requestedFamilies: readonly string[];
      readonly postScriptName?: string;
      readonly preferredAsset?: RequestedFont['preferredAsset'];
    };

const normalizedName = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase('en-US');
const compareCodeUnits = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const hex = (bytes: Uint8Array) => [...bytes]
  .map((value) => value.toString(16).padStart(2, '0'))
  .join('');

export const fingerprintFontBytes = async (bytes: Uint8Array) => {
  const copy = Uint8Array.from(bytes);
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', copy.buffer)));
};

const sourcePriority = (source: DocumentFontAsset['source']) => ({
  document: 0,
  imported: 1,
  'pdf-subset': 2,
  bundled: 3,
  system: 4
})[source];

const faceScore = (
  asset: DocumentFontAsset,
  style: { weight: number; stretch: number; italic: boolean }
) => Math.abs(asset.weight - style.weight)
  + Math.abs(asset.stretch - style.stretch) * 4
  + (asset.italic === style.italic ? 0 : 1_000);

const stableCandidates = (
  assets: readonly DocumentFontAsset[],
  style: { weight: number; stretch: number; italic: boolean }
) => [...assets].sort((left, right) => (
  faceScore(left, style) - faceScore(right, style)
  || sourcePriority(left.source) - sourcePriority(right.source)
  || compareCodeUnits(left.fingerprintSha256, right.fingerprintSha256)
  || left.faceIndex - right.faceIndex
  || compareCodeUnits(left.assetId, right.assetId)
));

export const resolveFontRequest = (
  assets: readonly DocumentFontAsset[],
  request: RequestedFont,
  style: { weight: number; stretch: number; italic: boolean },
  substitutionFamilies: readonly string[] = []
): FontResolution => {
  const preferred = request.preferredAsset
    ? assets.find((asset) =>
      asset.fingerprintSha256 === request.preferredAsset!.fingerprintSha256
      && asset.faceIndex === request.preferredAsset!.faceIndex
    )
    : null;
  if (preferred) return { kind: 'exact', asset: preferred, matchedBy: 'preferred-asset' };
  if (request.postScriptName) {
    const postScriptName = normalizedName(request.postScriptName);
    const match = stableCandidates(
      assets.filter((asset) => normalizedName(asset.postScriptName ?? '') === postScriptName),
      style
    )[0];
    if (match) return { kind: 'exact', asset: match, matchedBy: 'postscript-name' };
  }
  for (const family of request.families) {
    const name = normalizedName(family);
    const match = stableCandidates(
      assets.filter((asset) => asset.familyNames.some((entry) => normalizedName(entry) === name)),
      style
    )[0];
    if (match) return { kind: 'exact', asset: match, matchedBy: 'family' };
  }
  for (const family of substitutionFamilies) {
    const name = normalizedName(family);
    const match = stableCandidates(
      assets.filter((asset) => asset.familyNames.some((entry) => normalizedName(entry) === name)),
      style
    )[0];
    if (match) return {
      kind: 'substituted',
      asset: match,
      requestedFamilies: [...request.families],
      substituteFamily: family
    };
  }
  return {
    kind: 'missing',
    requestedFamilies: [...request.families],
    ...(request.postScriptName ? { postScriptName: request.postScriptName } : {}),
    ...(request.preferredAsset ? { preferredAsset: { ...request.preferredAsset } } : {})
  };
};

/**
 * Owns one document's font bytes and parsed faces. Metadata is serializable;
 * byte providers and parsed objects remain runtime-only.
 */
export class DocumentFontRegistry {
  private readonly assetsById = new Map<string, DocumentFontAsset>();
  private readonly bytesByFingerprint = new Map<string, Uint8Array>();
  private readonly parsePromises = new Map<string, Promise<ParsedFontFace>>();
  private readonly parsedFaces = new Map<string, ParsedFontFace>();
  private readonly byteLengthByFingerprint = new Map<string, number>();
  private readonly availabilityListeners = new Set<() => void>();
  private disposed = false;
  private generation = 0;

  constructor(private readonly options: DocumentFontRegistryOptions) {}

  get assets(): readonly DocumentFontAsset[] {
    return [...this.assetsById.values()].sort((left, right) =>
      (left.assetId < right.assetId ? -1 : left.assetId > right.assetId ? 1 : 0)
      || left.faceIndex - right.faceIndex
    );
  }

  get byteSize() {
    let total = 0;
    this.bytesByFingerprint.forEach((bytes) => { total += bytes.byteLength; });
    return total;
  }

  get availableAssets(): readonly DocumentFontAsset[] {
    return this.assets.filter((asset) => this.bytesByFingerprint.has(asset.fingerprintSha256));
  }

  subscribeAvailability(listener: () => void) {
    this.assertActive();
    this.availabilityListeners.add(listener);
    return () => { this.availabilityListeners.delete(listener); };
  }

  async materializeBytes() {
    const unique = new Map<string, Uint8Array>();
    for (const asset of this.assets) {
      if (unique.has(asset.fingerprintSha256)) continue;
      if (
        asset.source === 'system'
        && (asset.embedding.level === 'restricted' || asset.embedding.bitmapOnly)
      ) throw new Error(`System font ${asset.assetId} does not permit portable document embedding.`);
      const bytes = await this.loadBytes(asset.assetId);
      if (!bytes) throw new Error(`Font bytes for ${asset.assetId} are unavailable.`);
      unique.set(asset.fingerprintSha256, Uint8Array.from(bytes));
    }
    return [...unique].map(([fingerprintSha256, bytes]) => ({ fingerprintSha256, bytes }));
  }

  registerReference(asset: DocumentFontAsset) {
    this.assertActive();
    this.validateAsset(asset);
    const knownLength = this.byteLengthByFingerprint.get(asset.fingerprintSha256);
    if (knownLength !== undefined && knownLength !== asset.byteLength) {
      throw new Error(`Font fingerprint ${asset.fingerprintSha256} has conflicting byte lengths.`);
    }
    this.assertCompatibleFaceAlias(asset);
    const existing = this.assetsById.get(asset.assetId);
    if (!existing && this.assetsById.size >= 256) {
      throw new Error('A document may contain at most 256 font faces.');
    }
    if (existing && (
      existing.fingerprintSha256 !== asset.fingerprintSha256
      || existing.faceIndex !== asset.faceIndex
    )) throw new Error(`Font asset ID ${asset.assetId} already identifies another face.`);
    this.assetsById.set(asset.assetId, structuredClone(asset));
    this.byteLengthByFingerprint.set(asset.fingerprintSha256, asset.byteLength);
    return this.assetsById.get(asset.assetId)!;
  }

  async registerBytes(bytes: Uint8Array, registration: FontRegistration) {
    this.assertActive();
    this.assertByteLength(bytes.byteLength);
    const fingerprint = await fingerprintFontBytes(bytes);
    if (
      registration.fingerprintSha256
      && registration.fingerprintSha256.toLowerCase() !== fingerprint
    ) throw new Error(`Font ${registration.assetId} does not match its SHA-256 fingerprint.`);
    const asset: DocumentFontAsset = {
      ...registration,
      fingerprintSha256: fingerprint,
      byteLength: bytes.byteLength
    };
    this.validateAsset(asset);
    const knownLength = this.byteLengthByFingerprint.get(fingerprint);
    if (knownLength !== undefined && knownLength !== bytes.byteLength) {
      throw new Error(`Font fingerprint ${fingerprint} has conflicting byte lengths.`);
    }
    this.assertCompatibleFaceAlias(asset);
    const existing = this.assetsById.get(asset.assetId);
    if (!existing && this.assetsById.size >= 256) {
      throw new Error('A document may contain at most 256 font faces.');
    }
    if (existing && (
      existing.fingerprintSha256 !== asset.fingerprintSha256
      || existing.faceIndex !== asset.faceIndex
    )) throw new Error(`Font asset ID ${asset.assetId} already identifies another face.`);
    const bytesWereAvailable = this.bytesByFingerprint.has(fingerprint);
    this.assertCanStoreBytes(fingerprint, bytes.byteLength);
    this.storeBytes(fingerprint, bytes);
    this.assetsById.set(asset.assetId, structuredClone(asset));
    this.byteLengthByFingerprint.set(fingerprint, bytes.byteLength);
    if (!existing || !bytesWereAvailable) this.notifyAvailability();
    return this.assetsById.get(asset.assetId)!;
  }

  async bytes(assetId: string) {
    const bytes = await this.loadBytes(assetId);
    return bytes ? Uint8Array.from(bytes) : null;
  }

  private async loadBytes(assetId: string) {
    this.assertActive();
    const generation = this.generation;
    const asset = this.assetsById.get(assetId);
    if (!asset) return null;
    const cached = this.bytesByFingerprint.get(asset.fingerprintSha256);
    if (cached) return cached;
    if (asset.source !== 'system' || !this.options.systemProvider) return null;
    const loaded = await this.options.systemProvider.load(asset);
    if (this.disposed || generation !== this.generation) {
      throw new Error('The document font registry was disposed while loading font bytes.');
    }
    if (!loaded) return null;
    this.assertByteLength(loaded.byteLength);
    const fingerprint = await fingerprintFontBytes(loaded);
    if (fingerprint !== asset.fingerprintSha256) {
      throw new Error(`System font ${asset.assetId} changed after it was registered.`);
    }
    this.storeBytes(fingerprint, loaded);
    this.notifyAvailability();
    return this.bytesByFingerprint.get(fingerprint)!;
  }

  async parse(assetId: string) {
    this.assertActive();
    const asset = this.assetsById.get(assetId);
    if (!asset) throw new Error(`Font asset ${assetId} is not registered.`);
    const cacheKey = `${asset.fingerprintSha256}:${asset.faceIndex}`;
    const cached = this.parsedFaces.get(cacheKey);
    if (cached) return cached;
    const pending = this.parsePromises.get(cacheKey);
    if (pending) return pending;
    const generation = this.generation;
    const request = (async () => {
      const bytes = await this.loadBytes(assetId);
      if (!bytes) throw new Error(`Font bytes for ${assetId} are unavailable.`);
      const parsed = await this.options.parser.parse(Uint8Array.from(bytes), asset);
      if (this.disposed || generation !== this.generation) {
        parsed.dispose?.();
        throw new Error('The document font registry was disposed while parsing a font.');
      }
      if (!Number.isSafeInteger(parsed.glyphCount) || parsed.glyphCount < 1) {
        parsed.dispose?.();
        throw new Error(`Font ${assetId} has invalid glyph metadata.`);
      }
      this.parsedFaces.set(cacheKey, parsed);
      return parsed;
    })().finally(() => this.parsePromises.delete(cacheKey));
    this.parsePromises.set(cacheKey, request);
    return request;
  }

  resolve(
    request: RequestedFont,
    style: { weight: number; stretch: number; italic: boolean },
    substitutionFamilies: readonly string[] = []
  ): FontResolution {
    this.assertActive();
    return resolveFontRequest(this.availableAssets, request, style, substitutionFamilies);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    this.parsedFaces.forEach((face) => face.dispose?.());
    this.parsedFaces.clear();
    this.parsePromises.clear();
    this.bytesByFingerprint.clear();
    this.assetsById.clear();
    this.byteLengthByFingerprint.clear();
    this.availabilityListeners.clear();
  }

  private assertActive() {
    if (this.disposed) throw new Error('The document font registry has been disposed.');
  }

  private assertByteLength(byteLength: number) {
    const maxFontBytes = this.options.maxFontBytes ?? DEFAULT_MAX_FONT_BYTES;
    if (!Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > maxFontBytes) {
      throw new Error(`Font bytes must be between 1 and ${maxFontBytes} bytes.`);
    }
  }

  private validateAsset(asset: DocumentFontAsset) {
    if (!/^[a-f\d]{64}$/i.test(asset.fingerprintSha256)) {
      throw new Error(`Font ${asset.assetId} has an invalid SHA-256 fingerprint.`);
    }
    this.assertByteLength(asset.byteLength);
    if (
      !asset.assetId || asset.assetId.length > 1_024
      || asset.familyNames.length < 1 || asset.familyNames.length > 64
      || asset.familyNames.some((name) => !name.trim() || name.length > 1_024)
      || !asset.styleName.trim() || asset.styleName.length > 1_024
      || (asset.postScriptName !== undefined && (!asset.postScriptName.trim() || asset.postScriptName.length > 1_024))
    ) {
      throw new Error('Font assets require an ID and at least one non-empty family name.');
    }
    if (
      !['bundled', 'document', 'system', 'imported', 'pdf-subset'].includes(asset.source)
      || !['sfnt', 'woff', 'woff2', 'raw-cff', 'unknown'].includes(asset.container)
      || !['truetype', 'cff', 'cff2', 'svg', 'bitmap', 'mixed', 'unknown'].includes(asset.outline)
      || !['installable', 'editable', 'preview-print', 'restricted', 'unknown'].includes(asset.embedding.level)
      || typeof asset.embedding.noSubsetting !== 'boolean'
      || typeof asset.embedding.bitmapOnly !== 'boolean'
      || typeof asset.italic !== 'boolean'
      || !Number.isSafeInteger(asset.faceIndex) || asset.faceIndex < 0 || asset.faceIndex >= 64
      || !Number.isFinite(asset.weight) || asset.weight < 1 || asset.weight > 1_000
      || !Number.isFinite(asset.stretch) || asset.stretch <= 0
    ) throw new Error(`Font ${asset.assetId} has invalid face metrics.`);
  }

  private assertCompatibleFaceAlias(asset: DocumentFontAsset) {
    const alias = [...this.assetsById.values()].find((candidate) =>
      candidate.fingerprintSha256 === asset.fingerprintSha256
      && candidate.faceIndex === asset.faceIndex
    );
    if (!alias) return;
    if (
      alias.byteLength !== asset.byteLength
      || alias.container !== asset.container
      || alias.outline !== asset.outline
      || JSON.stringify(alias.embedding) !== JSON.stringify(asset.embedding)
    ) throw new Error(`Font face ${asset.fingerprintSha256}:${asset.faceIndex} has conflicting metadata.`);
  }

  private storeBytes(fingerprint: string, source: Uint8Array) {
    if (this.bytesByFingerprint.has(fingerprint)) return;
    this.assertCanStoreBytes(fingerprint, source.byteLength);
    this.bytesByFingerprint.set(fingerprint, Uint8Array.from(source));
  }

  private notifyAvailability() {
    this.availabilityListeners.forEach((listener) => listener());
  }

  private assertCanStoreBytes(fingerprint: string, byteLength: number) {
    if (this.bytesByFingerprint.has(fingerprint)) return;
    const maxTotalBytes = this.options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
    if (this.byteSize + byteLength > maxTotalBytes) {
      throw new Error(`Document fonts exceed the ${maxTotalBytes} byte limit.`);
    }
  }
}
