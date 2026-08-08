import type { Rect } from '../document/documentTypes';
import type { BrushDab } from '../tools/brush/strokeBuilder';
import type { AffineMatrix } from '../tools/transform/transformTypes';

const HISTORY_EDGE_PADDING = 2;

/**
 * Projects conservative document-space dab squares into raster-local space.
 *
 * An affine projection of an axis-aligned square has exact half extents
 * `r * (abs(row.x) + abs(row.y))`. Computing those directly avoids allocating
 * four corners and several mapped arrays for every dab on every paint frame.
 */
export const brushHistoryRegions = (
  dabs: readonly BrushDab[],
  documentToSource: AffineMatrix
): Rect[] => {
  const regions = new Array<Rect>(dabs.length);
  for (let index = 0; index < dabs.length; index += 1) {
    const dab = dabs[index]!;
    const radius = dab.size * 0.5;
    const centerX = documentToSource.a * dab.x
      + documentToSource.c * dab.y + documentToSource.tx;
    const centerY = documentToSource.b * dab.x
      + documentToSource.d * dab.y + documentToSource.ty;
    const halfWidth = radius
      * (Math.abs(documentToSource.a) + Math.abs(documentToSource.c));
    const halfHeight = radius
      * (Math.abs(documentToSource.b) + Math.abs(documentToSource.d));
    const left = centerX - halfWidth - HISTORY_EDGE_PADDING;
    const top = centerY - halfHeight - HISTORY_EDGE_PADDING;
    regions[index] = {
      x: left,
      y: top,
      width: halfWidth * 2 + HISTORY_EDGE_PADDING * 2,
      height: halfHeight * 2 + HISTORY_EDGE_PADDING * 2
    };
  }
  return regions;
};

/** Tight local source area required by the immutable Blur Brush snapshot. */
export const blurBrushSourceBounds = (
  dabs: readonly BrushDab[],
  documentToSource: AffineMatrix,
  width: number,
  height: number
): Rect | null => {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const dab of dabs) {
    // Mirrors the shader's bounded sampling radius. Dab size is intentionally
    // conservative: pressure can only reduce the rendered radius.
    const blurRadius = Math.min(32, Math.max(0.75, dab.size * 0.5 * 0.08));
    const documentHalfExtent = dab.size * 0.5 + blurRadius;
    const centerX = documentToSource.a * dab.x
      + documentToSource.c * dab.y + documentToSource.tx;
    const centerY = documentToSource.b * dab.x
      + documentToSource.d * dab.y + documentToSource.ty;
    const halfWidth = documentHalfExtent
      * (Math.abs(documentToSource.a) + Math.abs(documentToSource.c)) + 2;
    const halfHeight = documentHalfExtent
      * (Math.abs(documentToSource.b) + Math.abs(documentToSource.d)) + 2;
    left = Math.min(left, centerX - halfWidth);
    top = Math.min(top, centerY - halfHeight);
    right = Math.max(right, centerX + halfWidth);
    bottom = Math.max(bottom, centerY + halfHeight);
  }
  const x = Math.max(0, Math.floor(left));
  const y = Math.max(0, Math.floor(top));
  const clippedRight = Math.min(width, Math.ceil(right));
  const clippedBottom = Math.min(height, Math.ceil(bottom));
  return clippedRight > x && clippedBottom > y
    ? { x, y, width: clippedRight - x, height: clippedBottom - y }
    : null;
};
