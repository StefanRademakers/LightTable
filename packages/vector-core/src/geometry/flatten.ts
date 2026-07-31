import type { CubicSegment } from '../model/types';
import type { Vec2 } from '../math/vector';
import { cross, distanceSquared, dot, lengthSquared, subtract } from '../math/vector';
import { splitCubic } from './bezier';

export interface FlattenOptions {
  tolerance: number;
  maxDepth?: number;
}

const cubicIsFlat = ({ p0, p1, p2, p3 }: CubicSegment, toleranceSquared: number) => {
  const chord = subtract(p3, p0);
  const chordLengthSquared = lengthSquared(chord);
  if (chordLengthSquared < 1e-16) {
    return Math.max(distanceSquared(p1, p0), distanceSquared(p2, p0)) <= toleranceSquared;
  }

  const controls = [p1, p2];
  for (const control of controls) {
    const relative = subtract(control, p0);
    const area = cross(relative, chord);
    if ((area * area) / chordLengthSquared > toleranceSquared) return false;

    // Collinear controls outside the chord can backtrack or overshoot. A pure
    // distance-to-line test would silently collapse that geometry.
    const projection = dot(relative, chord) / chordLengthSquared;
    if (projection < 0 || projection > 1) return false;
  }
  return true;
};

export const flattenCubic = (segment: CubicSegment, options: FlattenOptions): Vec2[] => {
  if (!(options.tolerance > 0) || !Number.isFinite(options.tolerance)) {
    throw new RangeError('Flatten tolerance must be a finite value greater than zero.');
  }
  const toleranceSquared = options.tolerance * options.tolerance;
  const maxDepth = options.maxDepth ?? 18;
  const points: Vec2[] = [{ ...segment.p0 }];

  const append = (candidate: CubicSegment, depth: number) => {
    const flat = cubicIsFlat(candidate, toleranceSquared);
    if (flat || depth >= maxDepth) {
      points.push({ ...candidate.p3 });
      return;
    }
    const split = splitCubic(candidate, 0.5);
    append(split.left, depth + 1);
    append(split.right, depth + 1);
  };

  append(segment, 0);
  return points;
};
