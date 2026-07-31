/** Minimal rectangle contract keeps the geometry primitive document-agnostic. */
export interface TransformRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Canonical CPU-side 2D affine transform.
 *
 * Values remain JavaScript numbers (double precision) until they cross the GPU
 * boundary. The matrix maps a point as:
 *
 *   x' = a*x + c*y + tx
 *   y' = b*x + d*y + ty
 */
export interface AffineMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

export interface TransformPoint {
  x: number;
  y: number;
}

export const identityAffineMatrix = (): AffineMatrix => ({
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  tx: 0,
  ty: 0
});

export const identityMatrix = identityAffineMatrix;

export const isFiniteAffineMatrix = (value: AffineMatrix) =>
  Number.isFinite(value.a)
  && Number.isFinite(value.b)
  && Number.isFinite(value.c)
  && Number.isFinite(value.d)
  && Number.isFinite(value.tx)
  && Number.isFinite(value.ty);

export const isIdentityAffineMatrix = (value: AffineMatrix, epsilon = 1e-6) =>
  Math.abs(value.a - 1) <= epsilon
  && Math.abs(value.b) <= epsilon
  && Math.abs(value.c) <= epsilon
  && Math.abs(value.d - 1) <= epsilon
  && Math.abs(value.tx) <= epsilon
  && Math.abs(value.ty) <= epsilon;

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
  ...identityAffineMatrix(),
  tx: x,
  ty: y
});

export const scaleMatrix = (x: number, y: number): AffineMatrix => ({
  ...identityAffineMatrix(),
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

export const rectCorners = (
  rect: TransformRect
): [TransformPoint, TransformPoint, TransformPoint, TransformPoint] => [
  { x: rect.x, y: rect.y },
  { x: rect.x + rect.width, y: rect.y },
  { x: rect.x + rect.width, y: rect.y + rect.height },
  { x: rect.x, y: rect.y + rect.height }
];

export const transformedBounds = (matrix: AffineMatrix, rect: TransformRect): TransformRect => {
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
