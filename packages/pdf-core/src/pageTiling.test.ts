import { describe, expect, it } from 'vitest';
import { planPdfPageTiles } from './pageTiling';

const page = {
  pageIndex: 2,
  cropBox: { x: 10, y: 20, width: 10_001, height: 6_001 },
  rotation: 0 as const,
  userUnit: 1
};

describe('PDF page tile planning', () => {
  it('partitions the crop box without content overlap and uses bounded guards', () => {
    const plan = planPdfPageTiles(page, 1, { maximumTileEdgePixels: 4096, guardPixels: 2 });
    expect(plan.unrotatedPixelSize).toEqual({ width: 10_001, height: 6_001 });
    expect(plan.tiles).toHaveLength(6);
    expect(plan.tiles[0]).toMatchObject({
      id: 'page-2-tile-0-0', column: 0, row: 0,
      contentPixels: { x: 0, y: 0, width: 4096, height: 4096 },
      renderPixels: { x: 0, y: 0, width: 4098, height: 4098 }
    });
    expect(plan.tiles[1]).toMatchObject({
      contentPixels: { x: 4096, y: 0, width: 4096, height: 4096 },
      renderPixels: { x: 4094, y: 0, width: 4100, height: 4098 }
    });
    expect(plan.tiles.at(-1)?.contentPixels).toEqual({ x: 8192, y: 4096, width: 1809, height: 1905 });
    const contentPixels = plan.tiles.reduce((sum, tile) => sum + tile.contentPixels.width * tile.contentPixels.height, 0);
    expect(contentPixels).toBe(10_001 * 6_001);
    expect(plan.renderedPixelCount).toBeGreaterThan(contentPixels);
  });

  it('accounts for user units, scale and page rotation without changing tile authority', () => {
    const plan = planPdfPageTiles({ ...page, rotation: 90, userUnit: 2 }, 0.5);
    expect(plan.effectiveScale).toBe(1);
    expect(plan.unrotatedPixelSize).toEqual({ width: 10_001, height: 6_001 });
    expect(plan.outputPixelSize).toEqual({ width: 6_001, height: 10_001 });
    expect(plan.tiles[0]?.contentPageBounds).toEqual({ x: 10, y: 20, width: 4096, height: 4096 });
  });

  it('returns no raster work for an empty crop box', () => {
    expect(planPdfPageTiles({ ...page, cropBox: { x: 0, y: 0, width: 0, height: 4 } }, 1).tiles)
      .toEqual([]);
  });

  it('rejects hostile scale, tile-count, overlap and pixel budgets before allocation', () => {
    expect(() => planPdfPageTiles(page, Number.POSITIVE_INFINITY)).toThrow('scalePixelsPerPoint');
    expect(() => planPdfPageTiles(page, 1, { maximumTileEdgePixels: 4, guardPixels: 2 }))
      .toThrow('leave positive tile content');
    expect(() => planPdfPageTiles(page, 1, { maximumTileEdgePixels: 100, maximumTileCount: 1 }))
      .toThrow('tile-count limit');
    expect(() => planPdfPageTiles(page, 1, { maximumRenderedPixels: 100 }))
      .toThrow('rendered-pixel budget');
  });
});
