import { describe, expect, it } from 'vitest';
import { createPointColorSample } from '../pointColor';
import { pointColorAxisWeight, pointColorSelectionWeight } from './pointColorSelection';

describe('Point Color selection weight', () => {
  const sample = createPointColorSample('sample', 0.55, 0.16, Math.PI - 0.02);

  it('selects the exact sampled coordinate at full weight', () => {
    expect(pointColorSelectionWeight(
      sample.lightness, sample.chroma, sample.hue, sample
    )).toBe(1);
  });

  it('wraps hue distance continuously across minus and plus pi', () => {
    const wrapped = pointColorSelectionWeight(0.55, 0.16, -Math.PI + 0.02, sample);
    const sameDistance = pointColorSelectionWeight(0.55, 0.16, Math.PI - 0.06, sample);
    expect(wrapped).toBeCloseTo(sameDistance, 12);
    expect(wrapped).toBeGreaterThan(0.9);
  });

  it('returns zero outside any selected axis and expands with range', () => {
    expect(pointColorSelectionWeight(0.95, sample.chroma, sample.hue, {
      ...sample, range: 0, luminanceRange: 0
    })).toBe(0);
    expect(pointColorSelectionWeight(0.95, sample.chroma, sample.hue, {
      ...sample, range: 100, luminanceRange: 100
    })).toBeGreaterThan(0);
  });

  it('uses smooth full, feathered and excluded axis regions', () => {
    expect(pointColorAxisWeight(0, 1)).toBe(1);
    expect(pointColorAxisWeight(0.75, 1)).toBeGreaterThan(0);
    expect(pointColorAxisWeight(0.75, 1)).toBeLessThan(1);
    expect(pointColorAxisWeight(1, 1)).toBe(0);
  });
});
