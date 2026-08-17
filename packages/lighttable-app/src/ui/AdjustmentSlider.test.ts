import { describe, expect, it } from 'vitest';
import { adjustmentSliderValueAtPosition } from './AdjustmentSlider';

describe('adjustmentSliderValueAtPosition', () => {
  it('maps pointer positions across the complete range', () => {
    expect(adjustmentSliderValueAtPosition(20, 20, 200, -100, 100, 1)).toBe(-100);
    expect(adjustmentSliderValueAtPosition(120, 20, 200, -100, 100, 1)).toBe(0);
    expect(adjustmentSliderValueAtPosition(220, 20, 200, -100, 100, 1)).toBe(100);
  });

  it('clamps outside positions and preserves fractional steps', () => {
    expect(adjustmentSliderValueAtPosition(-50, 0, 100, 0, 1, 0.01)).toBe(0);
    expect(adjustmentSliderValueAtPosition(33, 0, 100, 0, 1, 0.01)).toBe(0.33);
    expect(adjustmentSliderValueAtPosition(150, 0, 100, 0, 1, 0.01)).toBe(1);
  });
});
