import { describe, expect, it } from 'vitest';
import { morphologyPassPlan, morphologyStepSchedule } from './MorphologyCore';

describe('MorphologyCore planning', () => {
  it.each([1, 2, 4, 5, 17, 100, 500])('builds exact logarithmic line support for radius %i', (radius) => {
    const steps = morphologyStepSchedule(radius);
    expect(steps.reduce((sum, step) => sum + step, 0)).toBe(radius);
    let support = 0;
    for (const step of steps) {
      expect(step).toBeLessThanOrEqual(support * 2 + 1);
      support += step;
    }
  });

  it('uses an exact small disk and a bounded large-radius octagon', () => {
    expect(morphologyPassPlan({ radius: 4, shape: 'round' })).toEqual([
      { direction: [0, 0], step: 4, directRound: true }
    ]);
    const large = morphologyPassPlan({ radius: 500, shape: 'round' });
    expect(new Set(large.map(({ direction }) => direction.join(','))).size).toBe(4);
    expect(large.length).toBeLessThanOrEqual(32);
    const extent = (plan: typeof large, axis: 0 | 1) => plan.reduce((sum, pass) => (
      sum + Math.abs(pass.direction[axis]) * pass.step
    ), 0);
    expect(extent(large, 0)).toBe(500);
    expect(extent(large, 1)).toBe(500);
    const uneven = morphologyPassPlan({ radius: 5, shape: 'round' });
    expect(extent(uneven, 0)).toBe(5);
    expect(extent(uneven, 1)).toBe(5);
  });

  it('plans exact separable square support', () => {
    const plan = morphologyPassPlan({ radius: 9, shape: 'square' });
    const horizontal = plan.filter(({ direction }) => direction[0] === 1 && direction[1] === 0);
    const vertical = plan.filter(({ direction }) => direction[0] === 0 && direction[1] === 1);
    expect(horizontal.reduce((sum, pass) => sum + pass.step, 0)).toBe(9);
    expect(vertical.reduce((sum, pass) => sum + pass.step, 0)).toBe(9);
  });
});
