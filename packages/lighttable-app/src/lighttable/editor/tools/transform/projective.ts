import type { TransformPoint, TransformQuad } from './transformTypes';

export type ProjectiveMatrix = readonly [
  number, number, number,
  number, number, number,
  number, number, number
];

const EPSILON = 1e-10;

/**
 * Solves the homography that maps `from` to `to` using pivoted Gaussian
 * elimination. Four point pairs produce the eight independent coefficients;
 * h22 is normalized to one.
 */
export const solveProjectiveTransform = (
  from: TransformQuad,
  to: TransformQuad
): ProjectiveMatrix | null => {
  const rows = from.flatMap((point, index) => {
    const target = to[index];
    return [
      [point.x, point.y, 1, 0, 0, 0, -target.x * point.x, -target.x * point.y, target.x],
      [0, 0, 0, point.x, point.y, 1, -target.y * point.x, -target.y * point.y, target.y]
    ];
  });

  for (let column = 0; column < 8; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 8; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    }
    if (Math.abs(rows[pivot][column]) < EPSILON) return null;
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    for (let entry = column; entry < 9; entry += 1) rows[column][entry] /= divisor;
    for (let row = 0; row < 8; row += 1) {
      if (row === column) continue;
      const factor = rows[row][column];
      for (let entry = column; entry < 9; entry += 1) {
        rows[row][entry] -= factor * rows[column][entry];
      }
    }
  }

  return [
    rows[0][8], rows[1][8], rows[2][8],
    rows[3][8], rows[4][8], rows[5][8],
    rows[6][8], rows[7][8], 1
  ];
};

export const projectPoint = (
  matrix: ProjectiveMatrix,
  point: TransformPoint
): TransformPoint | null => {
  const denominator = matrix[6] * point.x + matrix[7] * point.y + matrix[8];
  if (Math.abs(denominator) < EPSILON) return null;
  return {
    x: (matrix[0] * point.x + matrix[1] * point.y + matrix[2]) / denominator,
    y: (matrix[3] * point.x + matrix[4] * point.y + matrix[5]) / denominator
  };
};
