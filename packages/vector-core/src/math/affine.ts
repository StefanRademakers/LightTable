import type { Rect, Vec2 } from './vector';
import { rectFromPoints } from './vector';

export interface AffineMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

export type TransformPoint = Vec2;
export type TransformRect = Rect;

export const identityAffineMatrix = (): AffineMatrix => ({
  a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0
});
export const identityMatrix = identityAffineMatrix;

export const isFiniteAffineMatrix = (value: AffineMatrix) => Object.values(value).every(Number.isFinite);
export const isIdentityAffineMatrix = (value: AffineMatrix, epsilon = 1e-6) =>
  Math.abs(value.a - 1) <= epsilon
  && Math.abs(value.b) <= epsilon
  && Math.abs(value.c) <= epsilon
  && Math.abs(value.d - 1) <= epsilon
  && Math.abs(value.tx) <= epsilon
  && Math.abs(value.ty) <= epsilon;

/** Returns left * right. The right-hand transform is applied first. */
export const multiplyMatrices = (left: AffineMatrix, right: AffineMatrix): AffineMatrix => ({
  a: left.a * right.a + left.c * right.b,
  b: left.b * right.a + left.d * right.b,
  c: left.a * right.c + left.c * right.d,
  d: left.b * right.c + left.d * right.d,
  tx: left.a * right.tx + left.c * right.ty + left.tx,
  ty: left.b * right.tx + left.d * right.ty + left.ty
});

export const translationMatrix = (x: number, y: number): AffineMatrix => ({
  ...identityAffineMatrix(), tx: x, ty: y
});
export const scaleMatrix = (x: number, y: number): AffineMatrix => ({
  ...identityAffineMatrix(), a: x, d: y
});
export const rotationMatrix = (radians: number): AffineMatrix => {
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return { a: cosine, b: sine, c: -sine, d: cosine, tx: 0, ty: 0 };
};
export const aroundPoint = (operation: AffineMatrix, point: Vec2): AffineMatrix =>
  multiplyMatrices(
    translationMatrix(point.x, point.y),
    multiplyMatrices(operation, translationMatrix(-point.x, -point.y))
  );

export const invertMatrix = (matrix: AffineMatrix): AffineMatrix | null => {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  const scale = Math.max(1, Math.abs(matrix.a), Math.abs(matrix.b), Math.abs(matrix.c), Math.abs(matrix.d));
  if (Math.abs(determinant) <= Number.EPSILON * scale * scale * 16) return null;
  const inverse = 1 / determinant;
  return {
    a: matrix.d * inverse,
    b: -matrix.b * inverse,
    c: -matrix.c * inverse,
    d: matrix.a * inverse,
    tx: (matrix.c * matrix.ty - matrix.d * matrix.tx) * inverse,
    ty: (matrix.b * matrix.tx - matrix.a * matrix.ty) * inverse
  };
};

export const transformPoint = (matrix: AffineMatrix, point: Vec2): Vec2 => ({
  x: matrix.a * point.x + matrix.c * point.y + matrix.tx,
  y: matrix.b * point.x + matrix.d * point.y + matrix.ty
});

export const rectCorners = (rect: Rect): [Vec2, Vec2, Vec2, Vec2] => [
  { x: rect.x, y: rect.y },
  { x: rect.x + rect.width, y: rect.y },
  { x: rect.x + rect.width, y: rect.y + rect.height },
  { x: rect.x, y: rect.y + rect.height }
];

export const transformedBounds = (matrix: AffineMatrix, rect: Rect): Rect =>
  rectFromPoints(rectCorners(rect).map((point) => transformPoint(matrix, point)))
  ?? { x: 0, y: 0, width: 0, height: 0 };

export const matrixApproximatelyEqual = (a: AffineMatrix, b: AffineMatrix, epsilon = 1e-6) =>
  Math.abs(a.a - b.a) <= epsilon
  && Math.abs(a.b - b.b) <= epsilon
  && Math.abs(a.c - b.c) <= epsilon
  && Math.abs(a.d - b.d) <= epsilon
  && Math.abs(a.tx - b.tx) <= epsilon
  && Math.abs(a.ty - b.ty) <= epsilon;
