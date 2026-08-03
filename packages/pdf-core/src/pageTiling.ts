import type { PdfPageDisplayList, PdfRect } from './types';

export interface PdfPageTileLimits {
  readonly maximumTileEdgePixels: number;
  readonly guardPixels: number;
  readonly maximumTileCount: number;
  readonly maximumRenderedPixels: number;
}

export const DEFAULT_PDF_PAGE_TILE_LIMITS: PdfPageTileLimits = Object.freeze({
  maximumTileEdgePixels: 4096,
  guardPixels: 2,
  maximumTileCount: 65_536,
  maximumRenderedPixels: 2_000_000_000
});

export interface PdfPixelRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PdfPageTile {
  readonly id: string;
  readonly column: number;
  readonly row: number;
  /** Non-overlapping destination pixels in the unrotated page raster. */
  readonly contentPixels: PdfPixelRect;
  /** Guard-expanded render pixels, clipped to the page raster. */
  readonly renderPixels: PdfPixelRect;
  readonly contentPageBounds: PdfRect;
  readonly renderPageBounds: PdfRect;
}

export interface PdfPageTilePlan {
  readonly pageIndex: number;
  readonly scalePixelsPerPoint: number;
  readonly effectiveScale: number;
  readonly unrotatedPixelSize: { readonly width: number; readonly height: number };
  readonly outputPixelSize: { readonly width: number; readonly height: number };
  readonly tiles: readonly PdfPageTile[];
  /** Includes duplicated guard pixels and is the actual raster-work budget. */
  readonly renderedPixelCount: number;
}

const positiveFinite = (value: number, name: string) => {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be finite and greater than zero.`);
};

const nonNegativeInteger = (value: number, name: string) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative safe integer.`);
};

const positiveInteger = (value: number, name: string) => {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive safe integer.`);
};

const checkedProduct = (left: number, right: number, name: string) => {
  const product = left * right;
  if (!Number.isSafeInteger(product)) throw new Error(`${name} exceeds safe integer precision.`);
  return product;
};

/**
 * Plans bounded tiles in the page's unrotated crop-box raster. Rotation only
 * changes the final output dimensions; consumers apply the canonical page
 * rotation while placing each tile.
 */
export const planPdfPageTiles = (
  page: Pick<PdfPageDisplayList, 'pageIndex' | 'cropBox' | 'rotation' | 'userUnit'>,
  scalePixelsPerPoint: number,
  limitOverrides: Partial<PdfPageTileLimits> = {}
): PdfPageTilePlan => {
  const limits = { ...DEFAULT_PDF_PAGE_TILE_LIMITS, ...limitOverrides };
  positiveFinite(scalePixelsPerPoint, 'scalePixelsPerPoint');
  positiveFinite(page.userUnit, 'page.userUnit');
  positiveInteger(limits.maximumTileEdgePixels, 'maximumTileEdgePixels');
  nonNegativeInteger(limits.guardPixels, 'guardPixels');
  positiveInteger(limits.maximumTileCount, 'maximumTileCount');
  positiveInteger(limits.maximumRenderedPixels, 'maximumRenderedPixels');
  if (limits.guardPixels * 2 >= limits.maximumTileEdgePixels) {
    throw new Error('guardPixels must leave positive tile content.');
  }
  if (![page.cropBox.x, page.cropBox.y, page.cropBox.width, page.cropBox.height].every(Number.isFinite)
    || page.cropBox.width < 0 || page.cropBox.height < 0) {
    throw new Error('page.cropBox must be finite with non-negative dimensions.');
  }

  const effectiveScale = scalePixelsPerPoint * page.userUnit;
  positiveFinite(effectiveScale, 'effectiveScale');
  const width = Math.ceil(page.cropBox.width * effectiveScale);
  const height = Math.ceil(page.cropBox.height * effectiveScale);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) {
    throw new Error('PDF page raster dimensions exceed safe integer precision.');
  }
  const rotated = page.rotation === 90 || page.rotation === 270;
  const outputPixelSize = rotated ? { width: height, height: width } : { width, height };
  if (width === 0 || height === 0) return {
    pageIndex: page.pageIndex, scalePixelsPerPoint, effectiveScale,
    unrotatedPixelSize: { width, height }, outputPixelSize, tiles: [], renderedPixelCount: 0
  };

  const columnCount = Math.ceil(width / limits.maximumTileEdgePixels);
  const rowCount = Math.ceil(height / limits.maximumTileEdgePixels);
  const tileCount = checkedProduct(columnCount, rowCount, 'PDF tile count');
  if (tileCount > limits.maximumTileCount) throw new Error('PDF page exceeds the tile-count limit.');
  const toPageBounds = (pixels: PdfPixelRect): PdfRect => ({
    x: page.cropBox.x + pixels.x / effectiveScale,
    y: page.cropBox.y + pixels.y / effectiveScale,
    width: pixels.width / effectiveScale,
    height: pixels.height / effectiveScale
  });
  const tiles: PdfPageTile[] = [];
  let renderedPixelCount = 0;
  for (let row = 0; row < rowCount; row += 1) {
    for (let column = 0; column < columnCount; column += 1) {
      const x = column * limits.maximumTileEdgePixels;
      const y = row * limits.maximumTileEdgePixels;
      const contentPixels = {
        x, y,
        width: Math.min(limits.maximumTileEdgePixels, width - x),
        height: Math.min(limits.maximumTileEdgePixels, height - y)
      };
      const renderX = Math.max(0, x - limits.guardPixels);
      const renderY = Math.max(0, y - limits.guardPixels);
      const renderRight = Math.min(width, x + contentPixels.width + limits.guardPixels);
      const renderBottom = Math.min(height, y + contentPixels.height + limits.guardPixels);
      const renderPixels = {
        x: renderX, y: renderY,
        width: renderRight - renderX, height: renderBottom - renderY
      };
      renderedPixelCount += checkedProduct(renderPixels.width, renderPixels.height, 'PDF tile pixel count');
      if (!Number.isSafeInteger(renderedPixelCount) || renderedPixelCount > limits.maximumRenderedPixels) {
        throw new Error('PDF page exceeds the rendered-pixel budget.');
      }
      tiles.push({
        id: `page-${page.pageIndex}-tile-${column}-${row}`, column, row,
        contentPixels, renderPixels,
        contentPageBounds: toPageBounds(contentPixels),
        renderPageBounds: toPageBounds(renderPixels)
      });
    }
  }
  return {
    pageIndex: page.pageIndex, scalePixelsPerPoint, effectiveScale,
    unrotatedPixelSize: { width, height }, outputPixelSize,
    tiles, renderedPixelCount
  };
};
