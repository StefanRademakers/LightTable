import { describe, expect, it } from 'vitest';
import { StrokeSmoother } from './strokeSmoother';

describe('StrokeSmoother', () => {
  it('is an exact pass-through at zero percent', () => {
    const smoother = new StrokeSmoother(0, 100);
    smoother.begin({ x: 0, y: 0, pressure: 0.5 });
    expect(smoother.add({ x: 10, y: 4, pressure: 1 }))
      .toEqual({ x: 10, y: 4, pressure: 1 });
    expect(smoother.finish()).toEqual([]);
  });

  it('reduces alternating pointer jitter', () => {
    const smoother = new StrokeSmoother(0.8, 80);
    smoother.begin({ x: 0, y: 0, pressure: 1 });
    const output = [
      smoother.add({ x: 10, y: 6, pressure: 1 }),
      smoother.add({ x: 20, y: -6, pressure: 1 }),
      smoother.add({ x: 30, y: 6, pressure: 1 })
    ];
    expect(Math.max(...output.map(({ y }) => Math.abs(y)))).toBeLessThan(6);
  });

  it('finishes exactly at the last raw point with bounded catch-up work', () => {
    const smoother = new StrokeSmoother(1, 128);
    smoother.begin({ x: 0, y: 0, pressure: 0.25 });
    smoother.add({ x: 100, y: 50, pressure: 0.75 });
    const tail = smoother.finish();
    expect(tail.length).toBeGreaterThan(0);
    expect(tail.length).toBeLessThanOrEqual(9);
    expect(tail.at(-1)).toEqual({ x: 100, y: 50, pressure: 0.75 });
  });

  it('responds to distance rather than the number of pointer events', () => {
    const coarse = new StrokeSmoother(0.6, 60);
    coarse.begin({ x: 0, y: 0, pressure: 1 });
    const coarsePoint = coarse.add({ x: 30, y: 0, pressure: 1 });

    const fine = new StrokeSmoother(0.6, 60);
    fine.begin({ x: 0, y: 0, pressure: 1 });
    fine.add({ x: 10, y: 0, pressure: 1 });
    fine.add({ x: 20, y: 0, pressure: 1 });
    const finePoint = fine.add({ x: 30, y: 0, pressure: 1 });
    expect(finePoint.x).toBeCloseTo(coarsePoint.x, 5);
  });

  it('extends beyond the former maximum without changing the zero-to-one range', () => {
    const formerMaximum = new StrokeSmoother(1, 128);
    formerMaximum.begin({ x: 0, y: 0, pressure: 1 });
    const formerPoint = formerMaximum.add({ x: 300, y: 0, pressure: 1 });

    const extended = new StrokeSmoother(2, 128);
    extended.begin({ x: 0, y: 0, pressure: 1 });
    const extendedPoint = extended.add({ x: 300, y: 0, pressure: 1 });

    expect(extendedPoint.x).toBeLessThan(formerPoint.x);
    expect(extended.finish().at(-1)).toEqual({ x: 300, y: 0, pressure: 1 });
  });

  it('preserves tool-specific point metadata', () => {
    const smoother = new StrokeSmoother<{
      x: number; y: number; pressure: number; timeMs: number; tiltX: number;
    }>(0.5, 40);
    smoother.begin({ x: 0, y: 0, pressure: 1, timeMs: 10, tiltX: 0 });
    expect(smoother.add({ x: 50, y: 0, pressure: 0.5, timeMs: 20, tiltX: 12 }))
      .toMatchObject({ timeMs: 20, tiltX: 12 });
  });
});
