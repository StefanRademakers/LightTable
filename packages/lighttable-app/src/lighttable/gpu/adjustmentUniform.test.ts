import { describe, expect, it } from 'vitest';
import { createDefaultAdjustments } from '../types';
import {
  ADJUSTMENT_UNIFORM_FLOATS,
  buildAdjustmentUniform,
  LINEAR_COMPOSITE_FLAG_INDEX
} from './adjustmentUniform';

describe('LightTable adjustment uniform packing', () => {
  it('writes the layer-composite flag where the basic shader reads padding1.x', () => {
    const flat = buildAdjustmentUniform(createDefaultAdjustments(), 1920, 1080, false);
    const layered = buildAdjustmentUniform(createDefaultAdjustments(), 1920, 1080, true);

    expect(flat).toHaveLength(ADJUSTMENT_UNIFORM_FLOATS);
    expect(layered).toHaveLength(ADJUSTMENT_UNIFORM_FLOATS);
    expect(flat[LINEAR_COMPOSITE_FLAG_INDEX]).toBe(0);
    expect(layered[LINEAR_COMPOSITE_FLAG_INDEX]).toBe(1);
  });

  it('keeps creative grading controls at their WGSL vec4 offset', () => {
    const settings = createDefaultAdjustments();
    settings.colorGrading.blending = 37;
    settings.colorGrading.balance = -12;
    const packed = buildAdjustmentUniform(settings, 100, 50, true);

    expect(packed[56]).toBe(37);
    expect(packed[57]).toBe(-12);
    expect(packed[58]).toBe(0);
    expect(packed[59]).toBe(0);
  });
});
