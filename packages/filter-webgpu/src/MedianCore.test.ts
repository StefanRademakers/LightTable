import { describe, expect, it } from 'vitest';
import { medianPassSchedule } from './MedianCore';

describe('medianPassSchedule', () => {
  it('keeps small authored windows exact', () => {
    expect(medianPassSchedule(1)).toEqual([{ sampleRadius: 1, step: 1, exact: true }]);
    expect(medianPassSchedule(2)).toEqual([{ sampleRadius: 2, step: 1, exact: true }]);
  });

  it('retains authored support with bounded hierarchical work', () => {
    for (const radius of [3, 17, 50, 100]) {
      const plan = medianPassSchedule(radius);
      const support = plan.reduce((sum, pass) => sum + pass.sampleRadius * pass.step, 0);
      expect(support).toBe(radius);
      expect(plan.length).toBeLessThanOrEqual(8);
      expect(Math.max(...plan.map(({ step }) => step))).toBeLessThanOrEqual(16);
    }
  });
});
