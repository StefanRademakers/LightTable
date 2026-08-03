import type { CaretStop, RealizedTextLayout } from '@lighttable/text-core';
import type { AffineMatrix } from '../../editor/geometry/affine';

export interface TextEditingLayoutHitTarget {
  readonly layout: RealizedTextLayout;
  readonly localToDocument: AffineMatrix;
}

const inversePoint = (matrix: AffineMatrix, point: { readonly x: number; readonly y: number }) => {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (Math.abs(determinant) < 1e-12) return null;
  const x = point.x - matrix.tx;
  const y = point.y - matrix.ty;
  return {
    x: (matrix.d * x - matrix.c * y) / determinant,
    y: (-matrix.b * x + matrix.a * y) / determinant
  };
};

export interface TextEditingHit {
  readonly offset: number;
  readonly affinity: CaretStop['affinity'];
  readonly distance: number;
}

export const hitTestTextEditingLayout = (
  target: TextEditingLayoutHitTarget,
  documentPoint: { readonly x: number; readonly y: number },
  tolerance = 4
): TextEditingHit | null => {
  const point = inversePoint(target.localToDocument, documentPoint);
  if (!point) return null;
  const bounds = target.layout.logicalBounds;
  if (
    point.x < bounds.x - tolerance || point.x > bounds.x + bounds.width + tolerance
    || point.y < bounds.y - tolerance || point.y > bounds.y + bounds.height + tolerance
  ) return null;
  let nearest: TextEditingHit | null = null;
  for (const stop of target.layout.caretStops) {
    const distance = Math.hypot(stop.x - point.x, stop.y - point.y);
    if (!nearest || distance < nearest.distance) {
      nearest = { offset: stop.textOffset, affinity: stop.affinity, distance };
    }
  }
  return nearest;
};
