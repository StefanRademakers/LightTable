import { describe, expect, it } from 'vitest';
import {
  HbGpuGlyphBlobCache,
  serializeHbGpuGlyphBlobKey,
  type HbGpuGlyphBlobKey
} from './hbGpuGlyphBlobCache';

const key = (glyphId: number, variations: Readonly<Record<string, number>> = {}): HbGpuGlyphBlobKey => ({
  fontFingerprintSha256: 'a'.repeat(64),
  faceIndex: 0,
  glyphId,
  variationCoordinates: variations,
  encoderRevision: 'harfbuzz-test'
});

describe('hb-gpu glyph blob cache', () => {
  it('serializes identity deterministically without viewport scale', () => {
    expect(serializeHbGpuGlyphBlobKey(key(7, { wght: 600, wdth: 90 })))
      .toBe(serializeHbGpuGlyphBlobKey(key(7, { wdth: 90, wght: 600 })));
    expect(serializeHbGpuGlyphBlobKey(key(8))).not.toBe(serializeHbGpuGlyphBlobKey(key(7)));
    expect(serializeHbGpuGlyphBlobKey({ ...key(7), encoderRevision: 'next' }))
      .not.toBe(serializeHbGpuGlyphBlobKey(key(7)));
  });

  it('owns inserted bytes and rejects conflicting immutable content', () => {
    const cache = new HbGpuGlyphBlobCache(256);
    const input = new Uint8Array(0);
    const blob = cache.put(key(1), input, [0, 0, 0, 0]);
    expect(cache.lookup(key(1))).toBe(blob);
    expect(cache.put(key(1), new Uint8Array(0), [0, 0, 0, 0])).toBe(blob);
    expect(() => cache.put(key(1), new Uint8Array(0), [1, 0, 0, 0]))
      .toThrow(/conflicting immutable content/);
    expect(cache.metrics()).toMatchObject({ entries: 1, hits: 2, misses: 1 });
  });

  it('evicts least-recently-used unpinned blobs by retained bytes', () => {
    const cache = new HbGpuGlyphBlobCache(64);
    const first = cache.put(key(1), new Uint8Array(0), [0, 0, 0, 0]);
    cache.put(key(2), new Uint8Array(0), [0, 0, 0, 0]);
    cache.lookup(key(1));
    cache.put(key(3), new Uint8Array(0), [0, 0, 0, 0]);
    expect(cache.lookup(key(1))).toBe(first);
    expect(cache.lookup(key(2))).toBeNull();
    expect(cache.metrics()).toMatchObject({ entries: 2, retainedBytes: 64, evictions: 1 });
  });

  it('pins submission blobs atomically until an idempotent release', () => {
    const cache = new HbGpuGlyphBlobCache(32);
    const blob = cache.put(key(1), new Uint8Array(0), [0, 0, 0, 0]);
    const release = cache.pin([blob, blob]);
    expect(cache.metrics()).toMatchObject({ pinnedEntries: 1 });
    expect(() => cache.put(key(2), new Uint8Array(0), [0, 0, 0, 0]))
      .toThrow(/unpinned capacity/);
    expect(cache.lookup(key(1))).toBe(blob);
    release();
    release();
    expect(cache.metrics()).toMatchObject({ pinnedEntries: 0 });
    expect(cache.put(key(2), new Uint8Array(0), [0, 0, 0, 0])).not.toBe(blob);
  });
});
