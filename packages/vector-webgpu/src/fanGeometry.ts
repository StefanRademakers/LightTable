import type { Vec2 } from '@lighttable/vector-core';
import type { RealizedVectorGeometry } from '@lighttable/vector-rendering';

const samePoint = (left: Vec2, right: Vec2) =>
  Math.abs(left.x - right.x) <= Number.EPSILON * 16
  && Math.abs(left.y - right.y) <= Number.EPSILON * 16;

const contourWithoutClosingDuplicate = (points: readonly Vec2[]) => {
  if (points.length > 1 && samePoint(points[0], points[points.length - 1])) {
    return points.slice(0, -1);
  }
  return points;
};

/**
 * Converts contours to signed triangle fans. The stencil pass, rather than
 * triangle coverage itself, resolves concavity, holes and winding semantics.
 */
export const buildStencilFanVertices = (geometry: RealizedVectorGeometry) => {
  const values: number[] = [];
  for (const subpath of geometry.subpaths) {
    const points = contourWithoutClosingDuplicate(subpath.points);
    if (points.length < 3) continue;
    const pivot = points[0];
    for (let index = 1; index < points.length - 1; index += 1) {
      const middle = points[index];
      const end = points[index + 1];
      values.push(pivot.x, pivot.y, middle.x, middle.y, end.x, end.y);
    }
  }
  return new Float32Array(values);
};

