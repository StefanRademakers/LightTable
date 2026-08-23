import type { AffineMatrix } from '../math/affine';
import { aroundPoint, multiplyMatrices, rotationMatrix, scaleMatrix, translationMatrix } from '../math/affine';
import type { Vec2 } from '../math/vector';
import { cloneVectorElement } from '../model/clone';
import type { VectorElement, VectorPaint, VectorPath } from '../model/types';

const withElementTransform = <TElement extends VectorElement>(
  element: TElement,
  transform: AffineMatrix
) => ({
  ...cloneVectorElement(element),
  transform,
  transformRevision: element.transformRevision + 1
}) as TElement;

/** Applies a parent-space operation while preserving path or live-shape authority. */
export const transformVectorElement = <TElement extends VectorElement>(
  element: TElement,
  operation: AffineMatrix
) => withElementTransform(element, multiplyMatrices(operation, element.transform));

export const translateVectorElement = <TElement extends VectorElement>(
  element: TElement,
  delta: Vec2
) => transformVectorElement(element, translationMatrix(delta.x, delta.y));

/**
 * Carries SVG/user-space paint with an authored object transform.
 *
 * Document-space gradients deliberately ignore the element matrix while
 * rendering. An object edit must therefore apply its document operation to
 * that paint explicitly; otherwise geometry moves underneath stationary
 * color. Object-bounds and layer paints already inherit their owning space.
 */
export const transformVectorElementDocumentPaint = <TElement extends VectorElement>(
  element: TElement,
  documentOperation: AffineMatrix
): TElement => {
  const next = cloneVectorElement(element);
  let changed = false;
  const transformPaint = (paint: VectorPaint | null): VectorPaint | null => {
    if (!paint || !('kind' in paint) || paint.coordinateSpace !== 'document') return paint;
    changed = true;
    return {
      ...paint,
      transform: multiplyMatrices(documentOperation, paint.transform)
    };
  };
  next.style.fill = transformPaint(next.style.fill);
  if (next.style.stroke) {
    next.style.stroke = {
      ...next.style.stroke,
      paint: transformPaint(next.style.stroke.paint)!
    };
  }
  if (!changed) return element;
  next.styleRevision += 1;
  return next as TElement;
};

/** Applies a parent/document-space operation without baking local geometry. */
export const transformVectorPath = (path: VectorPath, operation: AffineMatrix) =>
  transformVectorElement(path, operation);

export const translateVectorPath = (path: VectorPath, delta: Vec2) =>
  transformVectorPath(path, translationMatrix(delta.x, delta.y));

export const rotateVectorPath = (path: VectorPath, radians: number, documentPivot: Vec2) =>
  transformVectorPath(path, aroundPoint(rotationMatrix(radians), documentPivot));

export const scaleVectorPath = (path: VectorPath, value: Vec2, documentPivot: Vec2) =>
  transformVectorPath(path, aroundPoint(scaleMatrix(value.x, value.y), documentPivot));
