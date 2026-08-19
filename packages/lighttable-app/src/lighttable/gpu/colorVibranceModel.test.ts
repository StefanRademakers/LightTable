import { describe, expect, it } from 'vitest';
import {
  colorVibranceHueDistance,
  colorVibrancePositiveResponse,
  colorVibranceSkinProtection
} from './colorVibranceModel';

describe('Color and Vibrance protection model', () => {
  it('selects a broad skin-like OKLCH region without selecting neutrals or blue', () => {
    expect(colorVibranceSkinProtection(0.62, 0.12, 0.72)).toBeGreaterThan(0.99);
    expect(colorVibranceSkinProtection(0.62, 0, 0.72)).toBe(0);
    expect(colorVibranceSkinProtection(0.62, 0.12, -1.7)).toBe(0);
    expect(colorVibranceSkinProtection(0.62, 0.42, 0.72)).toBe(0);
  });

  it('keeps circular hue distance continuous across the wrap boundary', () => {
    expect(colorVibranceHueDistance(-Math.PI + 0.02, Math.PI - 0.02))
      .toBeCloseTo(0.04, 8);
  });

  it('gives muted non-skin color more positive response than skin or saturated color', () => {
    const mutedBlue = colorVibrancePositiveResponse(0.62, 0.06, -1.7);
    const skin = colorVibrancePositiveResponse(0.62, 0.12, 0.72);
    const saturatedBlue = colorVibrancePositiveResponse(0.62, 0.32, -1.7);
    expect(mutedBlue).toBeGreaterThan(skin);
    expect(mutedBlue).toBeGreaterThan(saturatedBlue);
    expect(skin).toBeGreaterThan(0);
  });
});
