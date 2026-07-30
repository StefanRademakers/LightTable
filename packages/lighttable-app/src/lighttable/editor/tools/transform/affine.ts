import type { Rect } from '../../document/documentTypes';
import type { AffineMatrix } from './transformTypes';
import { identityAffineMatrix } from '../../rendering/renderContract';

export interface TransformPoint {
  x: number;
  y: number;
}

export const identityMatrix = identityAffineMatrix;

/** Returns left * right: right is applied to the point first. */
export const multiplyMatrices = (left: AffineMatrix, right: AffineMatrix): AffineMatrix => ({
  a: left.a * right.a + left.c * right.b,
  b: left.b * right.a + left.d * right.b,
  c: left.a * right.c + left.c * right.d,
  d: left.b * right.c + left.d * right.d,
  tx: left.a * right.tx + left.c * right.ty + left.tx,
  ty: left.b * right.tx + left.d * right.ty + left.ty
});

export const translationMatrix = (x: number, y: number): AffineMatrix => ({
  ...identityMatrix(),
  tx: x,
  ty: y
});

export const scaleMatrix = (x: number, y: number): AffineMatrix => ({
  ...identityMatrix(),
  a: x,
  d: y
});

export const rotationMatrix = (radians: number): AffineMatrix => {
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return { a: cosine, b: sine, c: -sine, d: cosine, tx: 0, ty: 0 };
};

export const aroundPoint = (
  operation: AffineMatrix,
  point: TransformPoint
): AffineMatrix => multiplyMatrices(
  translationMatrix(point.x, point.y),
  multiplyMatrices(operation, translationMatrix(-point.x, -point.y))
);

export const invertMatrix = (matrix: AffineMatrix): AffineMatrix | null => {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (Math.abs(determinant) < 1e-8) return null;
  const inverseDeterminant = 1 / determinant;
  return {
    a: matrix.d * inverseDeterminant,
    b: -matrix.b * inverseDeterminant,
    c: -matrix.c * inverseDeterminant,
    d: matrix.a * inverseDeterminant,
    tx: (matrix.c * matrix.ty - matrix.d * matrix.tx) * inverseDeterminant,
    ty: (matrix.b * matrix.tx - matrix.a * matrix.ty) * inverseDeterminant
  };
};

export const transformPoint = (matrix: AffineMatrix, point: TransformPoint): TransformPoint => ({
  x: matrix.a * point.x + matrix.c * point.y + matrix.tx,
  y: matrix.b * point.x + matrix.d * point.y + matrix.ty
});

export const rectCorners = (rect: Rect): [TransformPoint, TransformPoint, TransformPoint, TransformPoint] => [
  { x: rect.x, y: rect.y },
  { x: rect.x + rect.width, y: rect.y },
  { x: rect.x + rect.width, y: rect.y + rect.height },
  { x: rect.x, y: rect.y + rect.height }
];

export const transformedBounds = (matrix: AffineMatrix, rect: Rect): Rect => {
  const corners = rectCorners(rect).map((point) => transformPoint(matrix, point));
  const xs = corners.map(({ x }) => x);
  const ys = corners.map(({ y }) => y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  return { x: left, y: top, width: right - left, height: bottom - top };
};

export const matrixApproximatelyEqual = (
  first: AffineMatrix,
  second: AffineMatrix,
  epsilon = 1e-6
) => (
  Math.abs(first.a - second.a) <= epsilon
  && Math.abs(first.b - second.b) <= epsilon
  && Math.abs(first.c - second.c) <= epsilon
  && Math.abs(first.d - second.d) <= epsilon
  && Math.abs(first.tx - second.tx) <= epsilon
  && Math.abs(first.ty - second.ty) <= epsilon
);
