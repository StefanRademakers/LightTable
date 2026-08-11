import { describe, expect, it } from 'vitest';
import {
  preventIncrementalTriangleFoldovers,
  preventTriangleFoldovers
} from './deformationStability';

describe('preventTriangleFoldovers', () => {
  it('keeps extreme edits on the original side of every triangle edge', () => {
    const source = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }];
    const target = preventTriangleFoldovers(source, [
      source[0]!, source[1]!, { x: 0, y: -10 }
    ], [0, 1, 2]);
    expect(target[2]!.y).toBeGreaterThan(0);
  });

  it('approaches the safety boundary continuously instead of falling through coarse steps', () => {
    const source = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }];
    const first = preventTriangleFoldovers(source, [
      source[0]!, source[1]!, { x: 0, y: -10 }
    ], [0, 1, 2]);
    const slightlyFurther = preventTriangleFoldovers(source, [
      source[0]!, source[1]!, { x: 0, y: -10.1 }
    ], [0, 1, 2]);

    expect(Math.abs(first[2]!.y - slightlyFurther[2]!.y)).toBeLessThan(0.01);
    expect(first[2]!.y).toBeCloseTo(0.25, 2);
  });
});

describe('preventIncrementalTriangleFoldovers', () => {
  it('preserves an accepted edit while limiting only the unsafe increment', () => {
    const source = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }];
    const accepted = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }];
    const desired = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: -5 }];
    const result = preventIncrementalTriangleFoldovers(source, accepted, desired, [0, 1, 2]);
    expect(result[2]!.y).toBeGreaterThan(0);
    expect(result[2]!.y).toBeLessThanOrEqual(accepted[2]!.y);
    expect(result[1]).toEqual(accepted[1]);
  });
});
