import { describe, expect, it } from 'vitest';
import { createDefaultAdjustments } from '../types';
import {
  ADJUSTMENT_UNIFORM_FLOATS,
  buildAdjustmentUniform,
  LINEAR_COMPOSITE_FLAG_INDEX,
  PHOTOSHOP_BLEND_PROFILE_OFFSET,
  PHOTOSHOP_BRIGHTNESS_CONTRAST_LUT_OFFSET,
  PHOTOSHOP_DOCUMENT_BIT_DEPTH_OFFSET,
  PHOTOSHOP_HUE_SATURATION_RANGES_OFFSET,
  PHOTOSHOP_LEVELS_CHANNELS_OFFSET,
  PHOTOSHOP_VIBRANCE_OFFSET,
  POINT_COLOR_PAYLOAD_OFFSET
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

    settings.gradientMap.photoshopCompatible = true;
    const compatible = buildAdjustmentUniform(settings, 100, 50, true);
    expect(compatible[63]).toBe(19);
  });

  it('packs a dedicated Photoshop Exposure payload after the native ABI', () => {
    const settings = createDefaultAdjustments();
    settings.photoshopAdjustment = {
      ...settings.photoshopAdjustment,
      kind: 'exposure',
      exposure: 2.25,
      exposureOffset: -0.125,
      exposureGamma: 1.8
    };

    const packed = buildAdjustmentUniform(settings, 100, 50, true);

    expect(packed[128]).toBe(3);
    expect(packed[137]).toBe(2.25);
    expect(packed[138]).toBe(-0.125);
    expect(packed[139]).toBeCloseTo(1.8);
  });

  it('packs the measured Brightness/Contrast curve and document profile', () => {
    const settings = createDefaultAdjustments();
    settings.photoshopAdjustment.brightness = 30;
    settings.photoshopAdjustment.contrast = 80;
    const packed = buildAdjustmentUniform(
      settings, 100, 50, true, null, 'adobe-rgb-1998'
    );
    expect(packed[PHOTOSHOP_BRIGHTNESS_CONTRAST_LUT_OFFSET + 32]).toBeGreaterThan(0.5);
    expect(packed[PHOTOSHOP_BLEND_PROFILE_OFFSET]).toBe(1);
  });

  it('packs document bit depth for bit-depth-sensitive Photoshop adjustments', () => {
    const packed = buildAdjustmentUniform(
      createDefaultAdjustments(), 100, 50, true, null, 'srgb', 8
    );
    expect(packed[PHOTOSHOP_DOCUMENT_BIT_DEPTH_OFFSET]).toBe(8);
  });

  it('packs Photoshop Vibrance independently from the native Grade controls', () => {
    const settings = createDefaultAdjustments();
    settings.photoshopAdjustment.kind = 'vibrance';
    settings.photoshopAdjustment.vibrance = 80;
    settings.photoshopAdjustment.vibranceSaturation = -20;
    const packed = buildAdjustmentUniform(settings, 100, 50, true);

    expect(packed[128]).toBe(14);
    expect(Array.from(packed.slice(
      PHOTOSHOP_VIBRANCE_OFFSET,
      PHOTOSHOP_VIBRANCE_OFFSET + 2
    ))).toEqual([80, -20]);
    expect(packed[9]).toBe(0);
    expect(packed[10]).toBe(0);
  });

  it('reserves a distinct evaluator kind for current Color and Vibrance', () => {
    const settings = createDefaultAdjustments();
    settings.photoshopAdjustment.kind = 'color-vibrance';
    const packed = buildAdjustmentUniform(settings, 100, 50, true);
    expect(packed[128]).toBe(15);
  });

  it('packs Levels channel and the built-in Color Lookup preset', () => {
    const settings = createDefaultAdjustments();
    settings.photoshopAdjustment.levelsChannel = 'blue';
    settings.photoshopAdjustment.levels.red = {
      input: [12, 1.25, 238], output: [4, 249]
    };
    settings.photoshopAdjustment.colorLookupPreset = 'teal-orange';
    const packed = buildAdjustmentUniform(settings, 100, 50, true);
    expect(packed[225]).toBe(3);
    expect(packed[226]).toBe(3);
    expect(Array.from(packed.slice(
      PHOTOSHOP_LEVELS_CHANNELS_OFFSET,
      PHOTOSHOP_LEVELS_CHANNELS_OFFSET + 5
    ))).toEqual([12, 1.25, 238, 4, 249]);
  });

  it('packs Photoshop Hue/Saturation range boundaries and values', () => {
    const settings = createDefaultAdjustments();
    settings.photoshopAdjustment.hueSaturationRanges.reds = {
      boundaries: [300, 330, 20, 50], hue: 40, saturation: -60, lightness: 80
    };
    const packed = buildAdjustmentUniform(settings, 100, 100, true);
    expect(Array.from(packed.slice(
      PHOTOSHOP_HUE_SATURATION_RANGES_OFFSET,
      PHOTOSHOP_HUE_SATURATION_RANGES_OFFSET + 7
    ))).toEqual([300, 330, 20, 50, 40, -60, 80]);
  });
  it('keeps Post-crop Vignette out of the Grade uniform', () => {
    const baseline = createDefaultAdjustments();
    const changed = createDefaultAdjustments();
    changed.effects.vignette = {
      enabled: true,
      amount: -80,
      midpoint: 25,
      roundness: 70,
      feather: 15,
      highlights: 90
    };

    expect(Array.from(buildAdjustmentUniform(changed, 100, 50, true)))
      .toEqual(Array.from(buildAdjustmentUniform(baseline, 100, 50, true)));
  });

  it('packs Point Color samples as three aligned vec4 rows', () => {
    const settings = createDefaultAdjustments();
    settings.pointColor = { samples: [{
      id: 'sample', lightness: 0.7, chroma: 0.12, hue: 0.8,
      hueShift: 15, saturationShift: -20, luminanceShift: 10, variance: -30,
      range: 60, hueRange: 40, saturationRange: 50, luminanceRange: 70
    }] };
    const packed = buildAdjustmentUniform(settings, 100, 50, true);
    const values = Array.from(packed.slice(
      POINT_COLOR_PAYLOAD_OFFSET,
      POINT_COLOR_PAYLOAD_OFFSET + 12
    ));
    [0.7, 0.12, 0.8, 1, 15, -20, 10, -30, 60, 40, 50, 70]
      .forEach((expected, index) => expect(values[index]).toBeCloseTo(expected, 5));
  });
});
