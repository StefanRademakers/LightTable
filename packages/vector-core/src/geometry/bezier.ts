import type { CubicSegment } from '../model/types';
import type { Rect, Vec2 } from '../math/vector';
import { add, clamp01, distanceSquared, dot, lerp, multiplyScalar, rectFromPoints, subtract } from '../math/vector';

export interface CubicSplit {
  left: CubicSegment;
  right: CubicSegment;
  point: Vec2;
}

export interface NearestPointOnCubic {
  point: Vec2;
  t: number;
  distanceSquared: number;
}

export const evaluateCubic = (segment: CubicSegment, t: number): Vec2 => {
  const clamped = clamp01(t);
  const inverse = 1 - clamped;
  const inverse2 = inverse * inverse;
  const t2 = clamped * clamped;
  return add(
    add(multiplyScalar(segment.p0, inverse2 * inverse), multiplyScalar(segment.p1, 3 * inverse2 * clamped)),
    add(multiplyScalar(segment.p2, 3 * inverse * t2), multiplyScalar(segment.p3, t2 * clamped))
  );
};

export const cubicDerivative = (segment: CubicSegment, t: number): Vec2 => {
  const clamped = clamp01(t);
  const inverse = 1 - clamped;
  return add(
    multiplyScalar(subtract(segment.p1, segment.p0), 3 * inverse * inverse),
    add(
      multiplyScalar(subtract(segment.p2, segment.p1), 6 * inverse * clamped),
      multiplyScalar(subtract(segment.p3, segment.p2), 3 * clamped * clamped)
    )
  );
};

export const cubicSecondDerivative = (segment: CubicSegment, t: number): Vec2 => {
  const clamped = clamp01(t);
  return add(
    multiplyScalar(add(subtract(segment.p2, multiplyScalar(segment.p1, 2)), segment.p0), 6 * (1 - clamped)),
    multiplyScalar(add(subtract(segment.p3, multiplyScalar(segment.p2, 2)), segment.p1), 6 * clamped)
  );
};

export const splitCubic = (segment: CubicSegment, t: number): CubicSplit => {
  const clamped = clamp01(t);
  const a = lerp(segment.p0, segment.p1, clamped);
  const b = lerp(segment.p1, segment.p2, clamped);
  const c = lerp(segment.p2, segment.p3, clamped);
  const d = lerp(a, b, clamped);
  const e = lerp(b, c, clamped);
  const point = lerp(d, e, clamped);
  return {
    point,
    left: { ...segment, endAnchorId: '', p1: a, p2: d, p3: point },
    right: { ...segment, startAnchorId: '', p0: point, p1: e, p2: c }
  };
};

const quadraticRoots = (a: number, b: number, c: number): number[] => {
  if (Math.abs(a) < 1e-12) return Math.abs(b) < 1e-12 ? [] : [-c / b];
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return [];
  if (discriminant === 0) return [-b / (2 * a)];
  const root = Math.sqrt(discriminant);
  return [(-b + root) / (2 * a), (-b - root) / (2 * a)];
};

export const cubicExtrema = (p0: number, p1: number, p2: number, p3: number): number[] => {
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 3 * p0 - 6 * p1 + 3 * p2;
  const c = -3 * p0 + 3 * p1;
  return quadraticRoots(3 * a, 2 * b, c).filter((t) => t > 0 && t < 1);
};

export const cubicBounds = (segment: CubicSegment): Rect => {
  const candidates = [
    segment.p0,
    segment.p3,
    ...cubicExtrema(segment.p0.x, segment.p1.x, segment.p2.x, segment.p3.x)
      .map((t) => evaluateCubic(segment, t)),
    ...cubicExtrema(segment.p0.y, segment.p1.y, segment.p2.y, segment.p3.y)
      .map((t) => evaluateCubic(segment, t))
  ];
  return rectFromPoints(candidates) ?? { x: 0, y: 0, width: 0, height: 0 };
};

/** Coarse search followed by Newton refinement; deterministic and allocation-light. */
export const nearestPointOnCubic = (
  segment: CubicSegment,
  target: Vec2,
  coarseSteps = 24,
  refinementSteps = 8
): NearestPointOnCubic => {
  let bestT = 0;
  let bestPoint = segment.p0;
  let bestDistance = distanceSquared(bestPoint, target);
  for (let step = 1; step <= coarseSteps; step += 1) {
    const t = step / coarseSteps;
    const point = evaluateCubic(segment, t);
    const candidateDistance = distanceSquared(point, target);
    if (candidateDistance < bestDistance) {
      bestT = t;
      bestPoint = point;
      bestDistance = candidateDistance;
    }
  }

  let t = bestT;
  for (let iteration = 0; iteration < refinementSteps; iteration += 1) {
    const point = evaluateCubic(segment, t);
    const first = cubicDerivative(segment, t);
    const second = cubicSecondDerivative(segment, t);
    const delta = subtract(point, target);
    const denominator = dot(first, first) + dot(delta, second);
    if (Math.abs(denominator) < 1e-12) break;
    const next = clamp01(t - dot(delta, first) / denominator);
    if (Math.abs(next - t) < 1e-8) {
      t = next;
      break;
    }
    t = next;
  }
  bestPoint = evaluateCubic(segment, t);
  return { point: bestPoint, t, distanceSquared: distanceSquared(bestPoint, target) };
};
