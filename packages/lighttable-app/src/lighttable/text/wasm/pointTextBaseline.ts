export interface PackedPointLayoutGeometry {
  readonly glyphGeometry: Float32Array;
  readonly lineGeometry: Float32Array;
  readonly caretGeometry: Float32Array;
  readonly selectionGeometry: Float32Array;
  readonly bounds: Float32Array;
}

/**
 * Parley positions a one-line flow from a top layout origin. LightTable point
 * text, Photoshop TySh and PDF text matrices all define their origin at the
 * first baseline. Translate every packed Y coordinate together so transforms
 * rotate around the authored insertion point instead of the line-box top.
 */
export const alignPackedPointTextBaseline = (
  geometry: PackedPointLayoutGeometry,
  baselineOriginY: number
) => {
  if (geometry.lineGeometry.length < 7 || !Number.isFinite(baselineOriginY)) return 0;
  const offsetY = baselineOriginY - geometry.lineGeometry[0]!;
  if (offsetY === 0) return 0;

  for (let index = 1; index < geometry.glyphGeometry.length; index += 4) {
    geometry.glyphGeometry[index] += offsetY;
  }
  for (let index = 0; index < geometry.lineGeometry.length; index += 7) {
    geometry.lineGeometry[index] += offsetY;
    geometry.lineGeometry[index + 4] += offsetY;
  }
  for (let index = 1; index < geometry.caretGeometry.length; index += 3) {
    geometry.caretGeometry[index] += offsetY;
  }
  for (let index = 1; index < geometry.selectionGeometry.length; index += 4) {
    geometry.selectionGeometry[index] += offsetY;
  }
  for (let index = 1; index < geometry.bounds.length; index += 4) {
    geometry.bounds[index] += offsetY;
  }
  return offsetY;
};
