import { describe, expect, it } from 'vitest';
import { StrokeBuilder } from './strokeBuilder';

describe('StrokeBuilder', () => {
  it('places distance-spaced dabs independent of event distance', () => {
    const stroke = new StrokeBuilder(20, 0.1, 20);
    expect(stroke.begin({ x: 0, y: 0, pressure: 1 })).toHaveLength(1);
    const dabs = stroke.add({ x: 10, y: 0, pressure: 1 });
    expect(dabs.map((dab) => dab.x)).toEqual([2, 4, 6, 8, 10]);
  });

  it('carries sub-spacing distance across events', () => {
    const stroke = new StrokeBuilder(20, 0.5, 20);
    stroke.begin({ x: 0, y: 0, pressure: 1 });
    expect(stroke.add({ x: 6, y: 0, pressure: 1 })).toEqual([]);
    expect(stroke.add({ x: 12, y: 0, pressure: 1 })[0].x).toBeCloseTo(10);
  });

  it('caps spacing for large tips so hard stroke edges remain continuous', () => {
    const stroke = new StrokeBuilder(1000, 0.05);
    stroke.begin({ x: 0, y: 0, pressure: 1 });
    const dabs = stroke.add({ x: 6, y: 0, pressure: 1 });
    expect(dabs.map(({ x }) => x)).toEqual([1.5, 3, 4.5, 6]);
    expect(dabs.every(({ flowScale }) => flowScale === 0.03)).toBe(true);
  });
});
