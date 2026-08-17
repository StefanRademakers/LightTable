import { describe, expect, it } from 'vitest';
import { createDefaultAdjustments } from './types';
import { calculateOutputTransformSettings } from './outputTransform';

describe('LightTable output transform settings', () => {
  it('keeps a neutral grade inactive', () => {
    expect(calculateOutputTransformSettings(createDefaultAdjustments())).toEqual({
      whites: 0,
      shoulderStrength: 0,
      active: false,
      vignette: createDefaultAdjustments().effects.vignette
    });
  });

  it('engages highlight headroom for linear Halation', () => {
    const adjustments = createDefaultAdjustments();
    adjustments.effects.halation.enabled = true;
    const output = calculateOutputTransformSettings(adjustments);
    expect(output.active).toBe(true);
    expect(output.shoulderStrength).toBeGreaterThan(0);
  });

  it('keeps Contrast inside its endpoint-preserving basic tone curve', () => {
    const adjustments = createDefaultAdjustments();
    adjustments.contrast = 100;

    const output = calculateOutputTransformSettings(adjustments);

    expect(output.active).toBe(true);
    expect(output.shoulderStrength).toBe(0);
  });

  it('treats the post-crop Vignette as an independent output effect', () => {
    const adjustments = createDefaultAdjustments();
    adjustments.effects.vignette = {
      enabled: true,
      amount: -65,
      midpoint: 38,
      roundness: 24,
      feather: 71,
      highlights: 55
    };

    const output = calculateOutputTransformSettings(adjustments);
    expect(output.active).toBe(true);
    expect(output.vignette).toEqual(adjustments.effects.vignette);
    expect(output.vignette).not.toBe(adjustments.effects.vignette);
  });
});
