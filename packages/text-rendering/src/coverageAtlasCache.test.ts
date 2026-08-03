import { describe, expect, it } from 'vitest';
import {
  COVERAGE_ATLAS_RASTERIZER_VERSION,
  CoverageAtlasCache,
  quantizeCoveragePpem,
  serializeCoverageAtlasGlyphKey,
  type CoverageAtlasGlyphKey
} from './coverageAtlasCache';

const key = (glyphId: number, variations: Readonly<Record<string, number>> = {}): CoverageAtlasGlyphKey => ({
  fontFingerprintSha256: 'a'.repeat(64), faceIndex: 0, glyphId, variationCoordinates: variations,
  syntheticBold: false, syntheticItalic: false,
  hinting: 'smooth', ppem: 24, renderMode: 'alpha', rasterizerVersion: COVERAGE_ATLAS_RASTERIZER_VERSION
});

describe('production coverage atlas cache', () => {
  it('serializes every raster-affecting field deterministically', () => {
    expect(serializeCoverageAtlasGlyphKey(key(7, { wght: 600, wdth: 90 })))
      .toBe(serializeCoverageAtlasGlyphKey(key(7, { wdth: 90, wght: 600 })));
    expect(serializeCoverageAtlasGlyphKey(key(8))).not.toBe(serializeCoverageAtlasGlyphKey(key(7)));
    expect(serializeCoverageAtlasGlyphKey({ ...key(7), syntheticBold: true }))
      .not.toBe(serializeCoverageAtlasGlyphKey(key(7)));
    expect(serializeCoverageAtlasGlyphKey(key(7, { wght: 600.00001 })))
      .toBe(serializeCoverageAtlasGlyphKey(key(7, { wght: Math.fround(600.00001) })));
    expect(quantizeCoveragePpem(23.4)).toBe(23);
    expect(quantizeCoveragePpem(190)).toBe(192);
    expect(() => serializeCoverageAtlasGlyphKey({
      ...key(7), rasterizerVersion: 2
    } as unknown as CoverageAtlasGlyphKey)).toThrow(/version/);
  });

  it('packs hits and empty glyphs without wasting a page', () => {
    const cache = new CoverageAtlasCache(64, 2, 1);
    const first = cache.reserve(key(1), 10, 12);
    expect(first.placement).toMatchObject({ pageId: 1, x: 1, y: 1, empty: false });
    expect(cache.reserve(key(1), 10, 12)).toMatchObject({ created: false });
    expect(cache.reserve(key(2), 0, 0).placement).toMatchObject({ pageId: 0, empty: true });
    expect(cache.metrics()).toMatchObject({ pages: 1, entries: 2, hits: 1, misses: 2 });
  });

  it('evicts whole least-recently-used pages and rejects stale uploads', () => {
    const cache = new CoverageAtlasCache(64, 1, 1);
    const stale = cache.reserve(key(1), 60, 60).placement;
    const replacement = cache.reserve(key(2), 60, 60);
    expect(replacement.evictedPageId).toBe(stale.pageId);
    expect(cache.isCurrent(stale)).toBe(false);
    expect(() => cache.recordUpload(stale, 3_600)).toThrow(/stale/);
    cache.recordUpload(replacement.placement, 3_600);
    expect(cache.metrics()).toMatchObject({ pages: 1, entries: 1, evictions: 1, uploads: 1 });
  });

  it('invalidates every placement on device loss while keeping counters', () => {
    const cache = new CoverageAtlasCache(64, 1);
    const placement = cache.reserve(key(1), 8, 8).placement;
    cache.resetForDeviceLoss();
    expect(cache.isCurrent(placement)).toBe(false);
    expect(cache.metrics()).toMatchObject({ pages: 0, entries: 0, atlasGeneration: 2 });
  });

  it('discards a failed reservation without publishing a false cache hit', () => {
    const cache = new CoverageAtlasCache(64, 1);
    const failed = cache.reserve(key(1), 8, 8).placement;
    expect(cache.discardReservation(failed)).toBe(true);
    expect(cache.isCurrent(failed)).toBe(false);
    expect(cache.reserve(key(1), 8, 8)).toMatchObject({ created: true });
  });

  it('bounds zero-area glyph identities with least-recently-used eviction', () => {
    const cache = new CoverageAtlasCache(64, 1, 1, 2);
    cache.reserve(key(1), 0, 0);
    cache.reserve(key(2), 0, 0);
    expect(cache.lookup(key(1))).not.toBeNull();
    cache.reserve(key(3), 0, 0);
    expect(cache.lookup(key(1))).not.toBeNull();
    expect(cache.lookup(key(2))).toBeNull();
    expect(cache.metrics()).toMatchObject({ entries: 2, evictions: 1 });
    const bounded = new CoverageAtlasCache(64, 1, 1, 1);
    const stale = bounded.reserve(key(4), 0, 0).placement;
    bounded.reserve(key(5), 0, 0);
    expect(bounded.isCurrent(stale)).toBe(false);
  });
});
