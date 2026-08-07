import {
  identityAffineMatrix,
  invertMatrix,
  multiplyMatrices,
  pathBounds,
  transformPoint,
  type AffineMatrix,
  type Vec2
} from '@lighttable/vector-core';
import type { GradientPaintInstance } from '@lighttable/paint-core';
import type { ResolvedVectorElement } from './vectorSceneQueries';

export interface ResolvedVectorGradientGeometry {
  readonly paint: GradientPaintInstance;
  readonly paintParentToDocument: AffineMatrix;
  readonly documentToPaintParent: AffineMatrix;
  readonly startInPaintParent: Vec2;
  readonly endInPaintParent: Vec2;
  readonly startInDocument: Vec2;
  readonly endInDocument: Vec2;
}

/** Shared geometry contract for rendering and interacting with gradient gizmos. */
export const resolveVectorGradientGeometry = (
  resolved: ResolvedVectorElement
): ResolvedVectorGradientGeometry | null => {
  const paint = resolved.element.style.fill;
  if (!paint || !('kind' in paint)) return null;
  let paintParentToDocument = identityAffineMatrix();
  if (paint.coordinateSpace === 'object-bounds') {
    const bounds = pathBounds(resolved.documentPath);
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;
    paintParentToDocument = multiplyMatrices(resolved.documentPath.transform, {
      a: bounds.width,
      b: 0,
      c: 0,
      d: bounds.height,
      tx: bounds.x,
      ty: bounds.y
    });
  }
  const documentToPaintParent = invertMatrix(paintParentToDocument);
  if (!documentToPaintParent) return null;
  const startInPaintParent = transformPoint(paint.transform, { x: 0, y: 0 });
  const endInPaintParent = transformPoint(paint.transform, { x: 1, y: 0 });
  return {
    paint,
    paintParentToDocument,
    documentToPaintParent,
    startInPaintParent,
    endInPaintParent,
    startInDocument: transformPoint(paintParentToDocument, startInPaintParent),
    endInDocument: transformPoint(paintParentToDocument, endInPaintParent)
  };
};
