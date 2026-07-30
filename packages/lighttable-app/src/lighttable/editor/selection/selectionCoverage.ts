import type { Rect } from '../document/documentTypes';

export interface SelectionCoverageBounds {
  coreBounds: Rect;
  supportBounds: Rect;
  peakCoverage: number;
}

const scanBounds = (
  bytes: Uint8Array,
  width: number,
  height: number,
  bytesPerRow: number,
  threshold: number
): Rect | null => {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * bytesPerRow;
    for (let x = 0; x < width; x += 1) {
      if (bytes[rowStart + x] < threshold) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return right < left || bottom < top
    ? null
    : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
};

/**
 * The gizmo follows the half-maximum contour of the selected visible content.
 * The support bounds deliberately retain every quantized non-zero pixel so a
 * feathered edge is transformed and invalidated without being clipped.
 */
export const selectionCoverageBounds = (
  bytes: Uint8Array,
  width: number,
  height: number,
  bytesPerRow: number
): SelectionCoverageBounds | null => {
  let peak = 0;
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * bytesPerRow;
    for (let x = 0; x < width; x += 1) peak = Math.max(peak, bytes[rowStart + x]);
  }
  if (peak <= 0) return null;
  const coreBounds = scanBounds(bytes, width, height, bytesPerRow, Math.max(1, Math.round(peak * 0.5)));
  const supportBounds = scanBounds(bytes, width, height, bytesPerRow, 1);
  return coreBounds && supportBounds
    ? { coreBounds, supportBounds, peakCoverage: peak / 255 }
    : null;
};
