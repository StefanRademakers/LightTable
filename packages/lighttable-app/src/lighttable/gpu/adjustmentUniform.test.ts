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

  it('packs the native Gradient Map after the existing grading ABI', () => {
    const settings = createDefaultAdjustments();
    settings.gradientMap = {
      enabled: true,
      reverse: true,
      dither: true,
      colorStops: [
        { position: 0, midpoint: 0.4, color: { r: 0.1, g: 0.2, b: 0.3 } },
        { position: 1, midpoint: 0.5, color: { r: 0.8, g: 0.9, b: 1 } }
      ],
      opacityStops: [
        { position: 0, midpoint: 0.5, opacity: 0.25 },
        { position: 1, midpoint: 0.6, opacity: 1 }
      ]
    };

    const packed = buildAdjustmentUniform(settings, 100, 50, true);

    expect([...packed.slice(60, 64)]).toEqual([1, 2, 2, 3]);
    expect([...packed.slice(64, 68)]).toEqual([
      expect.closeTo(0.1), expect.closeTo(0.2), expect.closeTo(0.3), 0
    ]);
    expect([...packed.slice(96, 100)]).toEqual([
      0, 0.25, 0.5, expect.closeTo(0.4)
    ]);
  });
});
