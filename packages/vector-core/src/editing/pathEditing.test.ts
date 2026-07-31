import { describe, expect, it } from 'vitest';
import { evaluateCubic } from '../geometry/bezier';
import { createAnchor, createSubpath } from '../model/factories';
import { segmentAt } from '../model/segments';
import { insertAnchorOnSegment } from './pathEditing';

describe('path editing', () => {
  it('inserts an exact on-curve anchor and preserves geometry', () => {
    const source = createSubpath('curve', [
      createAnchor('a', { x: 0, y: 0 }, { handleOut: { x: 20, y: 80 } }),
      createAnchor('b', { x: 100, y: 0 }, { handleIn: { x: 80, y: 80 } })
    ]);
    const original = segmentAt(source, 0);
    const result = insertAnchorOnSegment(source, 0, 0.4, 'inserted').subpath;
    expect(result.anchors).toHaveLength(3);
    expect(result.anchors[1].mode).toBe('smooth');
    for (const sample of [0, 0.15, 0.4, 0.7, 1]) {
      const expected = evaluateCubic(original, sample);
      const actual = sample <= 0.4
        ? evaluateCubic(segmentAt(result, 0), sample / 0.4)
        : evaluateCubic(segmentAt(result, 1), (sample - 0.4) / 0.6);
      expect(actual.x).toBeCloseTo(expected.x, 8);
      expect(actual.y).toBeCloseTo(expected.y, 8);
    }
  });
});
