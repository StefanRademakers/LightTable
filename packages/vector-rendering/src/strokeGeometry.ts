import {
  add,
  cross,
  distance,
  lerp,
  multiplyScalar,
  normalize,
  subtract,
  type Vec2,
  type VectorStroke
} from '@lighttable/vector-core';
import type { RealizedSubpath, RealizedVectorGeometry } from './realizePath';

const EPSILON = 1e-6;
const pointsEqual = (left: Vec2, right: Vec2) => distance(left, right) <= EPSILON;

export interface StrokeTriangleGeometry {
  vertices: Float32Array<ArrayBuffer>;
  triangleCount: number;
  estimatedBytes: number;
}

interface StrokeRun {
  points: Vec2[];
  closed: boolean;
}

const cleanPolyline = (points: readonly Vec2[]) => {
  const clean: Vec2[] = [];
  for (const point of points) {
    if (!clean.length || !pointsEqual(clean[clean.length - 1], point)) clean.push({ ...point });
  }
  if (clean.length > 1 && pointsEqual(clean[0], clean[clean.length - 1])) clean.pop();
  return clean;
};

const normalizedDash = (dash: readonly number[]) => {
  const values = dash.filter((value) => Number.isFinite(value) && value > EPSILON);
  return values.length % 2 === 1 ? [...values, ...values] : values;
};

/** Splits a flattened subpath into visible dash runs while preserving phase. */
export const strokeRuns = (
  subpath: RealizedSubpath,
  dash: readonly number[],
  dashOffset: number
): readonly StrokeRun[] => {
  const points = cleanPolyline(subpath.points);
  if (points.length < 2) return [];
  const pattern = normalizedDash(dash);
  if (!pattern.length) return [{ points, closed: subpath.closed }];

  const period = pattern.reduce((sum, value) => sum + value, 0);
  let phase = ((dashOffset % period) + period) % period;
  let dashIndex = 0;
  while (phase >= pattern[dashIndex] - EPSILON) {
    phase -= pattern[dashIndex];
    dashIndex = (dashIndex + 1) % pattern.length;
  }
  let remaining = pattern[dashIndex] - phase;
  let visible = dashIndex % 2 === 0;
  const runs: StrokeRun[] = [];
  let run: Vec2[] | null = null;
  const segmentCount = subpath.closed ? points.length : points.length - 1;

  for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
    const start = points[segmentIndex];
    const end = points[(segmentIndex + 1) % points.length];
    const segmentLength = distance(start, end);
    if (segmentLength <= EPSILON) continue;
    let consumed = 0;
    while (consumed < segmentLength - EPSILON) {
      const step = Math.min(remaining, segmentLength - consumed);
      const from = lerp(start, end, consumed / segmentLength);
      const to = lerp(start, end, (consumed + step) / segmentLength);
      if (visible) {
        run ??= [from];
        if (!pointsEqual(run[run.length - 1], to)) run.push(to);
      }
      consumed += step;
      remaining -= step;
      if (remaining <= EPSILON) {
        if (visible && run && run.length > 1) runs.push({ points: run, closed: false });
        run = null;
        dashIndex = (dashIndex + 1) % pattern.length;
        visible = dashIndex % 2 === 0;
        remaining = pattern[dashIndex];
      }
    }
  }
  if (visible && run && run.length > 1) runs.push({ points: run, closed: false });

  // A dash may cross a closed contour's seam. Join both fragments so the seam
  // does not receive two artificial end caps.
  if (subpath.closed && runs.length > 1) {
    const first = runs[0];
    const last = runs[runs.length - 1];
    if (pointsEqual(first.points[0], points[0]) && pointsEqual(last.points[last.points.length - 1], points[0])) {
      runs[0] = { points: [...last.points, ...first.points.slice(1)], closed: false };
      runs.pop();
    }
  }
  return runs;
};

const appendTriangle = (values: number[], a: Vec2, b: Vec2, c: Vec2) => {
  if (Math.abs(cross(subtract(b, a), subtract(c, a))) <= EPSILON) return;
  const triangle = cross(subtract(b, a), subtract(c, a)) > 0 ? [a, b, c] : [a, c, b];
  for (const point of triangle) values.push(point.x, point.y);
};

const offset = (point: Vec2, vector: Vec2, amount: number) =>
  add(point, multiplyScalar(vector, amount));

const signedPolylineArea = (points: readonly Vec2[]) => points.reduce((area, point, index) => {
  const next = points[(index + 1) % points.length];
  return area + point.x * next.y - next.x * point.y;
}, 0) / 2;

const strokeSideDistances = (stroke: VectorStroke, closedContourArea: number) => {
  if ((stroke.alignment ?? 'center') === 'center' || Math.abs(closedContourArea) <= EPSILON) {
    return { left: stroke.width / 2, right: stroke.width / 2 };
  }
  // With document-space y increasing downwards, a positive contour area has
  // its filled interior along normal(-dy, dx), our numerically "left" side.
  const interiorOnLeft = closedContourArea > 0;
  const inside = stroke.alignment === 'inside';
  const paintLeft = inside === interiorOnLeft;
  return paintLeft
    ? { left: stroke.width, right: 0 }
    : { left: 0, right: stroke.width };
};

const appendArc = (
  values: number[],
  center: Vec2,
  startVector: Vec2,
  endVector: Vec2,
  direction: 1 | -1,
  radius: number,
  tolerance: number
) => {
  let startAngle = Math.atan2(startVector.y, startVector.x);
  let endAngle = Math.atan2(endVector.y, endVector.x);
  if (direction > 0) while (endAngle <= startAngle) endAngle += Math.PI * 2;
  else while (endAngle >= startAngle) endAngle -= Math.PI * 2;
  const delta = endAngle - startAngle;
  // Bound the arc's sagitta by the same document-space tolerance used while
  // flattening the path. This keeps large round strokes smooth without
  // needlessly multiplying geometry for small on-screen strokes.
  const safeTolerance = Math.max(EPSILON, Math.min(radius, tolerance));
  const maxAngleFromTolerance = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - safeTolerance / radius)));
  const maxAngle = Math.max(Math.PI / 128, Math.min(Math.PI / 6, maxAngleFromTolerance));
  const steps = Math.max(2, Math.min(256, Math.ceil(Math.abs(delta) / maxAngle)));
  let previous = offset(center, { x: Math.cos(startAngle), y: Math.sin(startAngle) }, radius);
  for (let index = 1; index <= steps; index += 1) {
    const angle = startAngle + delta * (index / steps);
    const next = offset(center, { x: Math.cos(angle), y: Math.sin(angle) }, radius);
    appendTriangle(values, center, previous, next);
    previous = next;
  }
};

const appendJoin = (
  values: number[],
  point: Vec2,
  previousDirection: Vec2,
  nextDirection: Vec2,
  leftDistance: number,
  rightDistance: number,
  stroke: VectorStroke,
  tolerance: number
) => {
  const turn = cross(previousDirection, nextDirection);
  if (Math.abs(turn) <= EPSILON) return;
  const previousNormal = { x: -previousDirection.y, y: previousDirection.x };
  const nextNormal = { x: -nextDirection.y, y: nextDirection.x };
  const side = turn > 0 ? -1 : 1;
  const distance = side > 0 ? leftDistance : rightDistance;
  if (distance <= EPSILON) return;
  const previousOuter = offset(point, previousNormal, distance * side);
  const nextOuter = offset(point, nextNormal, distance * side);

  if (stroke.join === 'round') {
    appendArc(values, point, multiplyScalar(previousNormal, side), multiplyScalar(nextNormal, side), turn > 0 ? 1 : -1, distance, tolerance);
    return;
  }
  if (stroke.join === 'miter') {
    const miterDirection = normalize(add(
      multiplyScalar(previousNormal, side),
      multiplyScalar(nextNormal, side)
    ));
    const denominator = Math.abs(
      miterDirection.x * nextNormal.x * side + miterDirection.y * nextNormal.y * side
    );
    const miterLength = denominator > EPSILON ? distance / denominator : Number.POSITIVE_INFINITY;
    if (miterLength <= distance * Math.max(1, stroke.miterLimit)) {
      // The segment quads diverge on the outer side. Fill the complete wedge
      // from the authored vertex to both offset edges before extending its
      // outer half to the miter tip. Omitting the first triangle leaves one
      // radial crack at every flattened curve segment.
      appendTriangle(values, previousOuter, point, nextOuter);
      appendTriangle(values, previousOuter, offset(point, miterDirection, miterLength), nextOuter);
      return;
    }
  }
  appendTriangle(values, previousOuter, point, nextOuter);
};

const appendRun = (
  values: number[],
  run: StrokeRun,
  stroke: VectorStroke,
  tolerance: number,
  closedContourArea: number
) => {
  const points = cleanPolyline(run.points);
  const segmentCount = run.closed ? points.length : points.length - 1;
  if (segmentCount < 1 || stroke.width <= 0) return;
  const distances = strokeSideDistances(stroke, closedContourArea);
  const directions: Vec2[] = [];
  for (let index = 0; index < segmentCount; index += 1) {
    directions.push(normalize(subtract(points[(index + 1) % points.length], points[index])));
  }

  for (let index = 0; index < segmentCount; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    const direction = directions[index];
    const normal = { x: -direction.y, y: direction.x };
    const leftStart = offset(start, normal, distances.left);
    const rightStart = offset(start, normal, -distances.right);
    const leftEnd = offset(end, normal, distances.left);
    const rightEnd = offset(end, normal, -distances.right);
    appendTriangle(values, leftStart, rightStart, leftEnd);
    appendTriangle(values, rightStart, rightEnd, leftEnd);
  }

  const firstJoin = run.closed ? 0 : 1;
  const lastJoin = run.closed ? points.length : points.length - 1;
  for (let index = firstJoin; index < lastJoin; index += 1) {
    const previousIndex = (index - 1 + directions.length) % directions.length;
    const nextIndex = index % directions.length;
    appendJoin(values, points[index % points.length], directions[previousIndex], directions[nextIndex],
      distances.left, distances.right, stroke, tolerance);
  }
  if (run.closed) return;

  const start = points[0];
  const end = points[points.length - 1];
  const firstDirection = directions[0];
  const lastDirection = directions[directions.length - 1];
  if (stroke.cap === 'square') {
    const firstNormal = { x: -firstDirection.y, y: firstDirection.x };
    const lastNormal = { x: -lastDirection.y, y: lastDirection.x };
    const capExtension = Math.max(distances.left, distances.right);
    const startExtended = offset(start, firstDirection, -capExtension);
    const endExtended = offset(end, lastDirection, capExtension);
    appendTriangle(values, offset(start, firstNormal, distances.left), offset(start, firstNormal, -distances.right), offset(startExtended, firstNormal, distances.left));
    appendTriangle(values, offset(start, firstNormal, -distances.right), offset(startExtended, firstNormal, -distances.right), offset(startExtended, firstNormal, distances.left));
    appendTriangle(values, offset(end, lastNormal, distances.left), offset(end, lastNormal, -distances.right), offset(endExtended, lastNormal, distances.left));
    appendTriangle(values, offset(end, lastNormal, -distances.right), offset(endExtended, lastNormal, -distances.right), offset(endExtended, lastNormal, distances.left));
  } else if (stroke.cap === 'round') {
    const firstNormal = { x: -firstDirection.y, y: firstDirection.x };
    const lastNormal = { x: -lastDirection.y, y: lastDirection.x };
    const radius = Math.max(distances.left, distances.right);
    appendArc(values, start, firstNormal, multiplyScalar(firstNormal, -1), 1, radius, tolerance);
    appendArc(values, end, multiplyScalar(lastNormal, -1), lastNormal, 1, radius, tolerance);
  }
};

/** Builds a union-friendly triangle mesh in path-local coordinates. */
export const buildStrokeTriangleGeometry = (
  geometry: RealizedVectorGeometry,
  stroke: VectorStroke
): StrokeTriangleGeometry => {
  const values: number[] = [];
  if (!(stroke.width > 0) || !Number.isFinite(stroke.width)) {
    return { vertices: new Float32Array(), triangleCount: 0, estimatedBytes: 0 };
  }
  for (const subpath of geometry.subpaths) {
    const contourPoints = cleanPolyline(subpath.points);
    const closedContourArea = subpath.closed ? signedPolylineArea(contourPoints) : 0;
    for (const run of strokeRuns(subpath, stroke.dash, stroke.dashOffset)) {
      appendRun(values, run, stroke, geometry.key.toleranceBucket, closedContourArea);
    }
  }
  const vertices = new Float32Array(values);
  return {
    vertices,
    triangleCount: vertices.length / 6,
    estimatedBytes: vertices.byteLength
  };
};
