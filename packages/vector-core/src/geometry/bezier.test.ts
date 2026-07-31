import { describe, expect, it } from 'vitest';
import type { CubicSegment } from '../model/types';
import { cubicBounds, evaluateCubic, nearestPointOnCubic, splitCubic } from './bezier';

const arch: CubicSegment = {
  startAnchorId: 'a', endAnchorId: 'b',
  p0: { x: 0, y: 0 }, p1: { x: 0, y: 100 },
  p2: { x: 100, y: 100 }, p3: { x: 100, y: 0 }
};

describe('cubic bezier geometry', () => {
  it('evaluates endpoints and midpoint', () => {
    expect(evaluateCubic(arch, 0)).toEqual(arch.p0);
    expect(evaluateCubic(arch, 1)).toEqual(arch.p3);
    expect(evaluateCubic(arch, 0.5)).toEqual({ x: 50, y: 75 });
  });

  it('splits without changing the represented curve', () => {
    const split = splitCubic(arch, 0.3);
    expect(split.left.p3).toEqual(split.right.p0);
    for (const sample of [0, 0.1, 0.3, 0.65, 1]) {
      const original = evaluateCubic(arch, sample);
      const mapped = sample <= 0.3
        ? evaluateCubic(split.left, sample / 0.3)
        : evaluateCubic(split.right, (sample - 0.3) / 0.7);
      expect(mapped.x).toBeCloseTo(original.x, 9);
      expect(mapped.y).toBeCloseTo(original.y, 9);
    }
  });

  it('uses derivative extrema for tight bounds', () => {
    expect(cubicBounds(arch)).toEqual({ x: 0, y: 0, width: 100, height: 75 });
  });

  it('finds a stable nearest point on the curve', () => {
    const nearest = nearestPointOnCubic(arch, { x: 50, y: 90 });
    expect(nearest.t).toBeCloseTo(0.5, 5);
    expect(nearest.point).toEqual({ x: 50, y: 75 });
  });
});
