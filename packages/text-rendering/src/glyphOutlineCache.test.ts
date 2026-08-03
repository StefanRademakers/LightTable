import { describe, expect, it } from 'vitest';
import {
  GLYPH_OUTLINE_EXTRACTOR_VERSION,
  GlyphOutlineCache,
  serializeGlyphOutlineKey,
  type GlyphOutlineKey
} from './glyphOutlineCache';

const key = (glyphId: number, variationCoordinates: Readonly<Record<string, number>> = {}): GlyphOutlineKey => ({
  fontFingerprintSha256: 'a'.repeat(64),
  faceIndex: 0,
  glyphId,
  variationCoordinates,
  extractorVersion: GLYPH_OUTLINE_EXTRACTOR_VERSION
});

const outline = (x = 10) => ({
  unitsPerEm: 1_000,
  verbs: new Uint8Array([0, 1, 1, 4]),
  coordinates: new Float32Array([0, 0, x, 0, x, 10]),
  bounds: new Float32Array([0, 0, x, 10])
});

describe('scale-independent glyph outline cache', () => {
  it('serializes font/glyph/variation identity without size, transform or zoom', () => {
    expect(serializeGlyphOutlineKey(key(7, { wght: 600, wdth: 90 })))
      .toBe(serializeGlyphOutlineKey(key(7, { wdth: 90, wght: 600 })));
    expect(serializeGlyphOutlineKey(key(7, { wght: 600.00001 })))
      .toBe(serializeGlyphOutlineKey(key(7, { wght: Math.fround(600.00001) })));
    expect(serializeGlyphOutlineKey(key(8))).not.toBe(serializeGlyphOutlineKey(key(7)));
  });

  it('owns transferred tables and returns immutable cache identity', () => {
    const cache = new GlyphOutlineCache(1_024);
    const input = outline();
    const retained = cache.set(key(1), input);
    input.coordinates[0] = 999;
    expect(cache.get(key(1))).toBe(retained);
    expect(retained.coordinates[0]).toBe(0);
    expect(cache.metrics()).toMatchObject({ entries: 1, hits: 1, misses: 0 });
  });

  it('evicts least-recently-used outlines by retained bytes', () => {
    const oneEntryBytes = 64 + 4 + 24 + 16;
    const cache = new GlyphOutlineCache(oneEntryBytes * 2);
    cache.set(key(1), outline(10));
    cache.set(key(2), outline(20));
    cache.get(key(1));
    cache.set(key(3), outline(30));
    expect(cache.get(key(1))).toBeDefined();
    expect(cache.get(key(2))).toBeUndefined();
    expect(cache.metrics()).toMatchObject({ entries: 2, evictions: 1 });
  });

  it('rejects malformed verb arity before retaining worker data', () => {
    const cache = new GlyphOutlineCache();
    expect(() => cache.set(key(1), {
      ...outline(), verbs: new Uint8Array([0])
    })).toThrow(/coordinate count/);
    expect(cache.metrics()).toMatchObject({ entries: 0, byteLength: 0 });
  });
});
