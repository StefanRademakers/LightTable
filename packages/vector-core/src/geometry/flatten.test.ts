import { describe, expect, it } from 'vitest';
import { flattenCubic } from './flatten';

describe('flattenCubic', () => {
  it('keeps a straight cubic minimal', () => {
    const points = flattenCubic({
      startAnchorId: 'a', endAnchorId: 'b',
      p0: { x: 0, y: 0 }, p1: { x: 3, y: 0 },
      p2: { x: 7, y: 0 }, p3: { x: 10, y: 0 }
    }, { tolerance: 0.1 });
    expect(points).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
  });

  it('does not collapse collinear control-point overshoot', () => {
    const points = flattenCubic({
      startAnchorId: 'a', endAnchorId: 'b',
      p0: { x: 0, y: 0 }, p1: { x: 40, y: 0 },
      p2: { x: -30, y: 0 }, p3: { x: 10, y: 0 }
    }, { tolerance: 0.1 });
    expect(points.length).toBeGreaterThan(2);
    expect(Math.max(...points.map(point => point.x))).toBeGreaterThan(10);
  });

  it('rejects invalid tolerances', () => {
    expect(() => flattenCubic({
      startAnchorId: 'a', endAnchorId: 'b',
      p0: { x: 0, y: 0 }, p1: { x: 0, y: 0 },
      p2: { x: 1, y: 1 }, p3: { x: 1, y: 1 }
    }, { tolerance: 0 })).toThrow(RangeError);
  });
});
