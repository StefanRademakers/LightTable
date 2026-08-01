import type { AffineMatrix } from '../math/affine';
import { aroundPoint, multiplyMatrices, rotationMatrix, scaleMatrix, translationMatrix } from '../math/affine';
import type { Vec2 } from '../math/vector';
import { cloneVectorElement } from '../model/clone';
import type { VectorElement, VectorPath } from '../model/types';

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

/** Applies a parent/document-space operation without baking local geometry. */
export const transformVectorPath = (path: VectorPath, operation: AffineMatrix) =>
  transformVectorElement(path, operation);

export const translateVectorPath = (path: VectorPath, delta: Vec2) =>
  transformVectorPath(path, translationMatrix(delta.x, delta.y));

export const rotateVectorPath = (path: VectorPath, radians: number, documentPivot: Vec2) =>
  transformVectorPath(path, aroundPoint(rotationMatrix(radians), documentPivot));

export const scaleVectorPath = (path: VectorPath, value: Vec2, documentPivot: Vec2) =>
  transformVectorPath(path, aroundPoint(scaleMatrix(value.x, value.y), documentPivot));
