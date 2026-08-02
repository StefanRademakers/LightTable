import { describe, expect, it } from 'vitest';
import { projectPoint, solveProjectiveTransform } from './projective';
import type { TransformQuad } from './transformTypes';

const source: TransformQuad = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 80 },
  { x: 0, y: 80 }
];

describe('solveProjectiveTransform', () => {
  it('maps every destination corner back to its source corner', () => {
    const destination: TransformQuad = [
      { x: 14, y: 7 },
      { x: 130, y: 18 },
      { x: 112, y: 103 },
      { x: -8, y: 74 }
    ];
    const inverse = solveProjectiveTransform(destination, source);
    expect(inverse).not.toBeNull();
    destination.forEach((point, index) => {
      const mapped = projectPoint(inverse!, point);
      expect(mapped?.x).toBeCloseTo(source[index].x, 7);
      expect(mapped?.y).toBeCloseTo(source[index].y, 7);
    });
  });

  it('rejects a degenerate cage', () => {
    const line: TransformQuad = [
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }
    ];
    expect(solveProjectiveTransform(line, source)).toBeNull();
  });
});
