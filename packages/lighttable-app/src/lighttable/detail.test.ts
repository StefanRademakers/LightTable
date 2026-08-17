import { describe, expect, it } from 'vitest';
import { createDefaultDetail, detailIsActive } from './detail';

describe('Detail adjustments', () => {
  it('is an exact neutral bypass until an amount control is authored', () => {
    const defaults = createDefaultDetail();
    expect(detailIsActive(defaults)).toBe(false);
    expect(detailIsActive({ ...defaults, sharpeningRadius: 2.5 })).toBe(false);
    expect(detailIsActive({ ...defaults, sharpeningAmount: 1 })).toBe(true);
    expect(detailIsActive({ ...defaults, luminanceNoiseReduction: 1 })).toBe(true);
    expect(detailIsActive({ ...defaults, colorNoiseReduction: 1 })).toBe(true);
  });
});
