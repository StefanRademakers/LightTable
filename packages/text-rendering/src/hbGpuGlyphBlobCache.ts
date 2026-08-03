import { TextRendererResourceLimitError } from './contracts';
import { validateHbGpuEncodedGlyph } from './hbGpuBundle';

const ENTRY_OVERHEAD_BYTES = 32;

export interface HbGpuGlyphBlobKey {
  readonly fontFingerprintSha256: string;
  readonly faceIndex: number;
  readonly glyphId: number;
  readonly variationCoordinates: Readonly<Record<string, number>>;
  readonly encoderRevision: string;
}

export interface HbGpuGlyphBlob {
  readonly serializedKey: string;
  readonly encoded: Uint8Array;
  readonly extents: readonly [number, number, number, number];
  readonly retainedBytes: number;
}

export interface HbGpuGlyphBlobCacheMetrics {
  readonly entries: number;
  readonly retainedBytes: number;
  readonly pinnedEntries: number;
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
}

interface CacheEntry {
  readonly blob: HbGpuGlyphBlob;
  touched: number;
  pinCount: number;
}

const finiteInteger = (value: number, maximum: number, label: string) => {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new TypeError(`${label} must be an integer in [0, ${maximum}].`);
  }
};

const serializeF32 = (value: number) => {
  if (!Number.isFinite(value) || !Number.isFinite(Math.fround(value))) {
    throw new TypeError('hb-gpu variation coordinates must be finite f32 values.');
  }
  const bytes = new ArrayBuffer(4);
  new DataView(bytes).setFloat32(0, Object.is(value, -0) ? 0 : value, false);
  return new DataView(bytes).getUint32(0, false).toString(16).padStart(8, '0');
};

export const serializeHbGpuGlyphBlobKey = (key: HbGpuGlyphBlobKey) => {
  if (!/^[a-f0-9]{64}$/i.test(key.fontFingerprintSha256)) {
    throw new TypeError('hb-gpu font fingerprint must be SHA-256.');
  }
  finiteInteger(key.faceIndex, 0xffff_ffff, 'hb-gpu face index');
  finiteInteger(key.glyphId, 0xffff_ffff, 'hb-gpu glyph id');
  if (!key.encoderRevision || key.encoderRevision.length > 128) {
    throw new TypeError('hb-gpu encoder revision must be present and bounded.');
  }
  const variations = Object.entries(key.variationCoordinates)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  for (const [tag] of variations) {
    if (!/^[\x20-\x7e]{4}$/.test(tag)) {
      throw new TypeError('hb-gpu variation tags must contain four printable ASCII characters.');
    }
  }
  return [
    key.encoderRevision,
    key.fontFingerprintSha256.toLowerCase(),
    key.faceIndex,
    key.glyphId,
    variations.map(([tag, value]) => `${tag}:${serializeF32(value)}`).join(',')
  ].join('|');
};

const equalBytes = (left: Uint8Array, right: Uint8Array) => {
  if (left.byteLength !== right.byteLength) return false;
  return left.every((value, index) => value === right[index]);
};

const equalExtents = (
  left: readonly [number, number, number, number],
  right: readonly [number, number, number, number]
) => left.every((value, index) => value === right[index]);

/** Device-independent, byte-bounded LRU for immutable encoded hb-gpu glyphs. */
export class HbGpuGlyphBlobCache {
  private readonly entries = new Map<string, CacheEntry>();
  private clock = 0;
  private retainedBytes = 0;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(readonly budgetBytes = 32 * 1024 * 1024) {
    finiteInteger(budgetBytes, 512 * 1024 * 1024, 'hb-gpu glyph cache budget');
    if (budgetBytes < ENTRY_OVERHEAD_BYTES) {
      throw new TypeError(`hb-gpu glyph cache budget must be at least ${ENTRY_OVERHEAD_BYTES} bytes.`);
    }
  }

  lookup(key: HbGpuGlyphBlobKey, recordMiss = true): HbGpuGlyphBlob | null {
    const serialized = serializeHbGpuGlyphBlobKey(key);
    const entry = this.entries.get(serialized);
    if (!entry) {
      if (recordMiss) this.misses += 1;
      return null;
    }
    entry.touched = ++this.clock;
    this.hits += 1;
    return entry.blob;
  }

  put(
    key: HbGpuGlyphBlobKey,
    encoded: Uint8Array,
    extents: readonly [number, number, number, number]
  ): HbGpuGlyphBlob {
    const serialized = serializeHbGpuGlyphBlobKey(key);
    if (encoded.byteLength > 0) validateHbGpuEncodedGlyph(encoded);
    if (!extents.every(Number.isFinite)) throw new TypeError('hb-gpu glyph extents must be finite.');
    const existing = this.entries.get(serialized);
    if (existing) {
      if (!equalBytes(existing.blob.encoded, encoded) || !equalExtents(existing.blob.extents, extents)) {
        throw new Error('hb-gpu glyph cache key resolved to conflicting immutable content.');
      }
      existing.touched = ++this.clock;
      this.hits += 1;
      return existing.blob;
    }
    const retainedBytes = encoded.byteLength + ENTRY_OVERHEAD_BYTES;
    if (retainedBytes > this.budgetBytes) {
      throw new TextRendererResourceLimitError('hb-gpu glyph exceeds the complete cache budget.');
    }
    const requiredBytes = this.retainedBytes + retainedBytes - this.budgetBytes;
    const victims = [...this.entries.values()]
      .filter((entry) => entry.pinCount === 0)
      .sort((left, right) => left.touched - right.touched);
    let reclaimableBytes = 0;
    let victimCount = 0;
    while (reclaimableBytes < requiredBytes && victimCount < victims.length) {
      reclaimableBytes += victims[victimCount++].blob.retainedBytes;
    }
    if (reclaimableBytes < requiredBytes) {
      throw new TextRendererResourceLimitError('hb-gpu glyph cache has no unpinned capacity.');
    }
    for (let index = 0; index < victimCount; index += 1) {
      const victim = victims[index];
      this.entries.delete(victim.blob.serializedKey);
      this.retainedBytes -= victim.blob.retainedBytes;
      this.evictions += 1;
    }
    const blob: HbGpuGlyphBlob = {
      serializedKey: serialized,
      encoded: new Uint8Array(encoded),
      extents: [...extents] as [number, number, number, number],
      retainedBytes
    };
    this.entries.set(serialized, { blob, touched: ++this.clock, pinCount: 0 });
    this.retainedBytes += retainedBytes;
    this.misses += 1;
    return blob;
  }

  pin(blobs: readonly HbGpuGlyphBlob[]): () => void {
    const entries = new Set<CacheEntry>();
    for (const blob of blobs) {
      const entry = this.entries.get(blob.serializedKey);
      if (!entry || entry.blob !== blob) throw new Error('hb-gpu glyph cache cannot pin a stale blob.');
      entries.add(entry);
    }
    entries.forEach((entry) => { entry.pinCount += 1; });
    let released = false;
    return () => {
      if (released) return;
      released = true;
      entries.forEach((entry) => {
        if (entry.pinCount > 0) entry.pinCount -= 1;
      });
    };
  }

  clear() {
    if ([...this.entries.values()].some((entry) => entry.pinCount > 0)) {
      throw new Error('hb-gpu glyph cache cannot clear pinned blobs.');
    }
    this.entries.clear();
    this.retainedBytes = 0;
  }

  metrics(): HbGpuGlyphBlobCacheMetrics {
    return {
      entries: this.entries.size,
      retainedBytes: this.retainedBytes,
      pinnedEntries: [...this.entries.values()].filter((entry) => entry.pinCount > 0).length,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions
    };
  }
}
