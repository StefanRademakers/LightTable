import { describe, expect, it } from 'vitest';
import { createDefaultAdjustments } from './types';
import { calculateOutputTransformSettings } from './outputTransform';

describe('LightTable output transform settings', () => {
  it('keeps a neutral grade inactive', () => {
    expect(calculateOutputTransformSettings(createDefaultAdjustments())).toEqual({
      whites: 0,
      shoulderStrength: 0,
      active: false,
      vignette: 0
    });
  });

  it('engages highlight headroom for linear Halation', () => {
    const adjustments = createDefaultAdjustments();
    adjustments.effects.halation.enabled = true;
    const output = calculateOutputTransformSettings(adjustments);
    expect(output.active).toBe(true);
    expect(output.shoulderStrength).toBeGreaterThan(0);
  });
});
