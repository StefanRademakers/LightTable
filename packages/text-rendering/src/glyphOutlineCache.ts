import type { TextWorkerGlyphOutlineResult } from '@lighttable/text-core';

export const GLYPH_OUTLINE_EXTRACTOR_VERSION = 1 as const;
const ENTRY_OVERHEAD_BYTES = 64;

export interface GlyphOutlineKey {
  readonly fontFingerprintSha256: string;
  readonly faceIndex: number;
  readonly glyphId: number;
  readonly variationCoordinates: Readonly<Record<string, number>>;
  readonly extractorVersion: typeof GLYPH_OUTLINE_EXTRACTOR_VERSION;
}

interface Entry {
  readonly outline: TextWorkerGlyphOutlineResult;
  readonly byteLength: number;
  touched: number;
}

export interface GlyphOutlineCacheMetrics {
  readonly entries: number;
  readonly byteLength: number;
  readonly budgetBytes: number;
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
}

const finiteInteger = (value: number, maximum: number, label: string) => {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new TypeError(`${label} must be an integer in [0, ${maximum}].`);
  }
};

const serializeF32 = (value: number) => {
  if (!Number.isFinite(value) || !Number.isFinite(Math.fround(value))) {
    throw new TypeError('Glyph outline variation coordinates must be finite f32 values.');
  }
  const bytes = new ArrayBuffer(4);
  new DataView(bytes).setFloat32(0, Object.is(value, -0) ? 0 : value, false);
  return new DataView(bytes).getUint32(0, false).toString(16).padStart(8, '0');
};

export const serializeGlyphOutlineKey = (key: GlyphOutlineKey) => {
  if (!/^[a-f0-9]{64}$/i.test(key.fontFingerprintSha256)) {
    throw new TypeError('Glyph outline font fingerprint must be SHA-256.');
  }
  finiteInteger(key.faceIndex, 0xffff_ffff, 'Glyph outline face index');
  finiteInteger(key.glyphId, 0xffff, 'Glyph outline glyph id');
  if (key.extractorVersion !== GLYPH_OUTLINE_EXTRACTOR_VERSION) {
    throw new TypeError('Glyph outline extractor version is unsupported.');
  }
  const variations = Object.entries(key.variationCoordinates)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  if (variations.length > 64) throw new TypeError('Glyph outline exceeds the 64-axis limit.');
  for (const [tag] of variations) {
    if (!/^[\x20-\x7e]{4}$/.test(tag)) {
      throw new TypeError('Glyph outline variation tags must contain four printable ASCII characters.');
    }
  }
  return [
    `r${key.extractorVersion}`,
    key.fontFingerprintSha256.toLowerCase(),
    key.faceIndex,
    key.glyphId,
    variations.map(([tag, value]) => `${tag}:${serializeF32(value)}`).join(',')
  ].join('|');
};

const copyOutline = (outline: TextWorkerGlyphOutlineResult): TextWorkerGlyphOutlineResult => {
  finiteInteger(outline.unitsPerEm, 0xffff, 'Glyph outline units per em');
  if (outline.unitsPerEm < 16) throw new TypeError('Glyph outline units per em must be at least 16.');
  if (!(outline.verbs instanceof Uint8Array) || outline.verbs.length > 32_768) {
    throw new TypeError('Glyph outline verbs must be a bounded Uint8Array.');
  }
  if (!(outline.coordinates instanceof Float32Array)) {
    throw new TypeError('Glyph outline coordinates must be a Float32Array.');
  }
  if (!(outline.bounds instanceof Float32Array) || outline.bounds.length !== 4) {
    throw new TypeError('Glyph outline bounds must contain four Float32 values.');
  }
  const arity = [2, 2, 4, 6, 0] as const;
  let coordinateCount = 0;
  for (const verb of outline.verbs) {
    if (verb > 4) throw new TypeError('Glyph outline contains an unknown verb.');
    coordinateCount += arity[verb];
  }
  if (outline.coordinates.length !== coordinateCount) {
    throw new TypeError('Glyph outline coordinate count does not match its verbs.');
  }
  if (![...outline.coordinates, ...outline.bounds].every(Number.isFinite)) {
    throw new TypeError('Glyph outline geometry must be finite.');
  }
  return Object.freeze({
    unitsPerEm: outline.unitsPerEm,
    verbs: new Uint8Array(outline.verbs),
    coordinates: new Float32Array(outline.coordinates),
    bounds: new Float32Array(outline.bounds)
  });
};

/** Byte-bounded LRU for immutable, scale-independent glyph outline tables. */
export class GlyphOutlineCache {
  private readonly entries = new Map<string, Entry>();
  private clock = 0;
  private byteLength = 0;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(readonly budgetBytes = 32 * 1024 * 1024) {
    if (!Number.isSafeInteger(budgetBytes) || budgetBytes < 0) {
      throw new RangeError('Glyph outline cache budget must be a non-negative safe integer.');
    }
  }

  get(key: GlyphOutlineKey) {
    const entry = this.entries.get(serializeGlyphOutlineKey(key));
    if (!entry) {
      this.misses += 1;
      return undefined;
    }
    entry.touched = ++this.clock;
    this.hits += 1;
    return entry.outline;
  }

  set(key: GlyphOutlineKey, value: TextWorkerGlyphOutlineResult) {
    const serialized = serializeGlyphOutlineKey(key);
    const outline = copyOutline(value);
    const byteLength = ENTRY_OVERHEAD_BYTES + outline.verbs.byteLength
      + outline.coordinates.byteLength + outline.bounds.byteLength;
    const previous = this.entries.get(serialized);
    if (previous) {
      this.entries.delete(serialized);
      this.byteLength -= previous.byteLength;
    }
    if (byteLength > this.budgetBytes) return outline;
    this.entries.set(serialized, { outline, byteLength, touched: ++this.clock });
    this.byteLength += byteLength;
    while (this.byteLength > this.budgetBytes) this.evictOldest();
    return outline;
  }

  clear() {
    this.entries.clear();
    this.byteLength = 0;
  }

  metrics(): GlyphOutlineCacheMetrics {
    return Object.freeze({
      entries: this.entries.size,
      byteLength: this.byteLength,
      budgetBytes: this.budgetBytes,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions
    });
  }

  private evictOldest() {
    let oldestKey: string | null = null;
    let oldestTouch = Number.POSITIVE_INFINITY;
    for (const [key, entry] of this.entries) {
      if (entry.touched < oldestTouch) {
        oldestKey = key;
        oldestTouch = entry.touched;
      }
    }
    if (oldestKey === null) return;
    const entry = this.entries.get(oldestKey)!;
    this.entries.delete(oldestKey);
    this.byteLength -= entry.byteLength;
    this.evictions += 1;
  }
}
