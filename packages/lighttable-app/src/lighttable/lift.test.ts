import { describe, expect, it } from 'vitest';
import { applyLiftChannel, liftUiToPedestal } from './lift';

describe('LightTable Lift', () => {
  it('moves exact black while exposure-style multiplication cannot', () => {
    expect(0 * 2 ** 5).toBe(0);
    expect(applyLiftChannel(0, 100)).toBeCloseTo(0.16, 8);
  });

  it('keeps normalized white anchored', () => {
    expect(applyLiftChannel(1, 100)).toBeCloseTo(1, 8);
    expect(applyLiftChannel(1, -100)).toBeCloseTo(1, 8);
  });

  it('is neutral at zero and monotonic across a grayscale ramp', () => {
    expect(applyLiftChannel(0.37, 0)).toBeCloseTo(0.37, 8);
    const ramp = Array.from({ length: 257 }, (_, index) => applyLiftChannel(index / 256, 100));
    for (let index = 1; index < ramp.length; index += 1) {
      expect(ramp[index]).toBeGreaterThanOrEqual(ramp[index - 1]);
    }
  });

  it('supports a controlled negative pedestal without discontinuity', () => {
    expect(liftUiToPedestal(-100)).toBeCloseTo(-0.16, 8);
    expect(applyLiftChannel(0, -100)).toBeCloseTo(-0.16, 8);
    expect(applyLiftChannel(0.4, -0.001)).toBeCloseTo(0.4, 5);
    expect(applyLiftChannel(0.4, 0.001)).toBeCloseTo(0.4, 5);
  });
});
