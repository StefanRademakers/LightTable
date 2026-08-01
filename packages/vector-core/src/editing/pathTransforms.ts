import type { AffineMatrix } from '../math/affine';
import { aroundPoint, multiplyMatrices, rotationMatrix, scaleMatrix, translationMatrix } from '../math/affine';
import type { Vec2 } from '../math/vector';
import { cloneVectorPath } from '../model/clone';
import type { VectorPath } from '../model/types';

const withTransform = (path: VectorPath, transform: AffineMatrix) => ({
  ...cloneVectorPath(path),
  transform,
  geometryRevision: path.geometryRevision + 1
});

/** Applies a parent/document-space operation without baking local geometry. */
export const transformVectorPath = (path: VectorPath, operation: AffineMatrix) =>
  withTransform(path, multiplyMatrices(operation, path.transform));

export const translateVectorPath = (path: VectorPath, delta: Vec2) =>
  transformVectorPath(path, translationMatrix(delta.x, delta.y));

export const rotateVectorPath = (path: VectorPath, radians: number, documentPivot: Vec2) =>
  transformVectorPath(path, aroundPoint(rotationMatrix(radians), documentPivot));

export const scaleVectorPath = (path: VectorPath, value: Vec2, documentPivot: Vec2) =>
  transformVectorPath(path, aroundPoint(scaleMatrix(value.x, value.y), documentPivot));
