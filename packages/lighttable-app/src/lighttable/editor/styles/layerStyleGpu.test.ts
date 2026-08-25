import { describe, expect, it } from 'vitest';
import {
  createDefaultLayerStyle,
  createDefaultLayerStyleGradient,
  createDefaultLayerStyleStack
} from './layerStyleDefaults';
import {
  baseLayerStyleUniform,
  bevelDistanceCapacity,
  bevelJumpFloodSteps,
  LAYER_STYLE_SETTINGS_FLOATS,
  layerStyleGaussianBlurPlan,
  layerStyleUniform,
  smoothBevelGaussianPlan,
  smoothBevelMultiscalePlan
} from './layerStyleGpu';

describe('Layer Style GPU settings', () => {
  it('grows retained Chisel distance support only at capacity boundaries', () => {
    expect(bevelDistanceCapacity(1)).toBe(1);
    expect(bevelDistanceCapacity(33)).toBe(64);
    expect(bevelDistanceCapacity(63.1)).toBe(64);
    expect(bevelDistanceCapacity(64.1)).toBe(128);
  });

  it('bounds Bevel distance propagation while preserving local JFA corrections', () => {
    expect(bevelJumpFloodSteps(1)).toEqual([1, 1, 1]);
    expect(bevelJumpFloodSteps(5)).toEqual([1, 4, 2, 1, 1]);
    expect(bevelJumpFloodSteps(250)).toEqual([1, 128, 64, 32, 16, 8, 4, 2, 1, 1]);
  });

  it('keeps every Smooth Bevel Gaussian cycle within contiguous 100px support', () => {
    expect(smoothBevelGaussianPlan(80)).toEqual({ cycles: 1, radiusPerCycle: 80 });
    expect(smoothBevelGaussianPlan(133)).toEqual({
      cycles: 2,
      radiusPerCycle: 133 / Math.sqrt(2)
    });
    expect(smoothBevelGaussianPlan(250)).toEqual({
      cycles: 7,
      radiusPerCycle: 250 / Math.sqrt(7)
    });
  });

  it('reduces large Smooth Bevel kernels while protecting tiny height fields', () => {
    expect(smoothBevelMultiscalePlan(133, 800, 400)).toEqual({
      scale: 16,
      workingWidth: 50,
      workingHeight: 25,
      workingRadius: 133 / 16
    });
    expect(smoothBevelMultiscalePlan(80, 252, 240)).toEqual({
      scale: 8,
      workingWidth: 32,
      workingHeight: 30,
      workingRadius: 10
    });
    expect(smoothBevelMultiscalePlan(133, 20, 20).scale).toBe(2);
    expect(smoothBevelMultiscalePlan(133, 800, 400, 8, 32)).toEqual({
      scale: 32,
      workingWidth: 25,
      workingHeight: 13,
      workingRadius: 4.15625
    });
  });

  it('keeps the base pass separate from effects and preserves Fill', () => {
    const values = baseLayerStyleUniform(0.25, 1920, 1080);
    expect(values).toHaveLength(LAYER_STYLE_SETTINGS_FLOATS);
    expect([...values.slice(0, 4)]).toEqual([0, 1, 0, 0.25]);
    expect([...values.slice(20, 22)]).toEqual([1920, 1080]);
  });

  it('selects normalized interactive and final blur quality tiers', () => {
    const effect = createDefaultLayerStyle('drop-shadow');
    const stack = createDefaultLayerStyleStack();
    expect(layerStyleUniform(effect, stack, 100, 100, true, 'interactive')?.[23]).toBe(16);
    expect(layerStyleUniform(effect, stack, 100, 100, true, 'final')?.[23]).toBe(24);
  });

  it('adapts blur sampling to effect radius with bounded interaction and final tiers', () => {
    const effect = createDefaultLayerStyle('drop-shadow');
    if (effect.kind !== 'drop-shadow') throw new Error('Expected Drop Shadow.');
    const stack = createDefaultLayerStyleStack();
    effect.size = 3;
    expect(layerStyleUniform(effect, stack, 100, 100, true, 'interactive')?.[23]).toBe(8);
    expect(layerStyleUniform(effect, stack, 100, 100, true, 'final')?.[23]).toBe(16);
    effect.size = 250;
    expect(layerStyleUniform(effect, stack, 100, 100, true, 'interactive')?.[23]).toBe(16);
    expect(layerStyleUniform(effect, stack, 100, 100, true, 'final')?.[23]).toBe(64);
  });

  it('keeps small strokes cheap and gives settled wide strokes round coverage', () => {
    const effect = createDefaultLayerStyle('stroke');
    if (effect.kind !== 'stroke') throw new Error('Expected Stroke.');
    const stack = createDefaultLayerStyleStack();
    effect.size = 3;
    expect(layerStyleUniform(effect, stack, 100, 100, true, 'interactive')?.[23]).toBe(16);
    expect(layerStyleUniform(effect, stack, 100, 100, true, 'final')?.[23]).toBe(24);
    effect.size = 200;
    expect(layerStyleUniform(effect, stack, 100, 100, true, 'interactive')?.[23]).toBe(32);
    expect(layerStyleUniform(effect, stack, 100, 100, true, 'final')?.[23]).toBe(128);
  });

  it('uses downsampled two-pass blur only for settled wide shadows', () => {
    const effect = createDefaultLayerStyle('drop-shadow');
    if (effect.kind !== 'drop-shadow') throw new Error('Expected Drop Shadow.');
    const stack = createDefaultLayerStyleStack();
    effect.size = 8;
    expect(layerStyleGaussianBlurPlan(effect, stack, 1000, 500, 'final')).toBeNull();
    effect.size = 29;
    expect(layerStyleGaussianBlurPlan(effect, stack, 1000, 500, 'interactive')).toEqual({
      scale: 5,
      workingWidth: 200,
      workingHeight: 100,
      workingRadius: 5.8
    });
    expect(layerStyleGaussianBlurPlan(effect, stack, 1000, 500, 'final')).toEqual({
      scale: 4,
      workingWidth: 250,
      workingHeight: 125,
      workingRadius: 7.25
    });
  });

  it('uses the settled Gaussian path for wide satin without changing small satin cost', () => {
    const effect = createDefaultLayerStyle('satin');
    if (effect.kind !== 'satin') throw new Error('Expected Satin.');
    const stack = createDefaultLayerStyleStack();
    effect.size = 8;
    expect(layerStyleGaussianBlurPlan(effect, stack, 500, 500, 'final')).toBeNull();
    effect.size = 60;
    expect(layerStyleGaussianBlurPlan(effect, stack, 500, 500, 'final')).toMatchObject({
      workingRadius: 7.5
    });
  });

  it('builds a settled height map for wide bevel normals', () => {
    const effect = createDefaultLayerStyle('bevel-emboss');
    if (effect.kind !== 'bevel-emboss') throw new Error('Expected Bevel.');
    const stack = createDefaultLayerStyleStack();
    effect.size = 20;
    expect(layerStyleGaussianBlurPlan(effect, stack, 500, 500, 'final')).toMatchObject({
      workingRadius: 20 / 3
    });
    effect.technique = 'chisel-hard';
    expect(layerStyleGaussianBlurPlan(effect, stack, 500, 500, 'final')).toBeNull();
  });

  it('uses global light and stack scaling for a shadow', () => {
    const stack = createDefaultLayerStyleStack();
    stack.scale = 2;
    stack.globalLight.angle = 135;
    const shadow = createDefaultLayerStyle('drop-shadow');
    if (shadow.kind !== 'drop-shadow') throw new Error('Expected Drop Shadow.');
    shadow.useGlobalLight = true;
    shadow.distance = 5;
    shadow.size = 8;
    const values = layerStyleUniform(shadow, stack, 800, 600)!;
    expect(values[0]).toBe(2);
    expect(values[12]).toBe(135);
    expect(values[13]).toBe(10);
    expect(values[14]).toBe(16);
    expect(values[22]).toBe(2);
    expect([...values.slice(120, 122)]).toEqual([0, 0]);
    expect([...values.slice(124, 126)]).toEqual([1, 1]);
  });

  it('packs transformed layer bounds and align-with-layer for gradients', () => {
    const effect = createDefaultLayerStyle('gradient-overlay');
    if (effect.kind !== 'gradient-overlay') throw new Error('Expected Gradient Overlay.');
    const values = layerStyleUniform(effect, createDefaultLayerStyleStack(), 800, 600,
      true, 'final', { x: 120, y: 80, width: 240, height: 160 })!;
    expect([...values.slice(89, 95)]).toEqual([120, 80, 240, 0.5, 160, 1]);
    effect.alignWithLayer = false;
    expect(layerStyleUniform(effect, createDefaultLayerStyleStack(), 800, 600)?.[94]).toBe(0);
  });

  it('does not render unresolved pattern assets', () => {
    const stack = createDefaultLayerStyleStack();
    expect(layerStyleUniform(createDefaultLayerStyle('pattern-overlay'), stack, 1, 1)).toBeNull();
  });

  it.each([
    'drop-shadow',
    'inner-shadow',
    'outer-glow',
    'inner-glow',
    'bevel-emboss',
    'color-overlay',
    'gradient-overlay',
    'pattern-overlay',
    'satin',
    'stroke'
  ] as const)('keeps disabled and zero-opacity %s effects off the GPU path', (kind) => {
    const stack = createDefaultLayerStyleStack();
    const disabled = createDefaultLayerStyle(kind);
    disabled.enabled = false;
    expect(layerStyleUniform(disabled, stack, 1, 1)).toBeNull();

    const transparent = createDefaultLayerStyle(kind);
    transparent.opacity = 0;
    expect(layerStyleUniform(transparent, stack, 1, 1)).toBeNull();
  });

  it('never substitutes layer pixels for a pattern that is missing on the GPU', () => {
    const stack = createDefaultLayerStyleStack();
    const overlay = createDefaultLayerStyle('pattern-overlay');
    if (overlay.kind !== 'pattern-overlay') throw new Error('Expected Pattern Overlay defaults.');
    overlay.pattern = { id: 'woven', name: 'Woven', assetId: 'asset-woven' };
    expect(layerStyleUniform(overlay, stack, 320, 240, false)).toBeNull();

    const stroke = createDefaultLayerStyle('stroke');
    if (stroke.kind !== 'stroke') throw new Error('Expected Stroke defaults.');
    stroke.fill = {
      type: 'pattern',
      pattern: { id: 'woven', name: 'Woven', assetId: 'asset-woven' },
      scale: 1,
      angle: 0
    };
    expect(layerStyleUniform(stroke, stack, 320, 240, false)).toBeNull();

    const bevel = createDefaultLayerStyle('bevel-emboss');
    if (bevel.kind !== 'bevel-emboss') throw new Error('Expected Bevel defaults.');
    bevel.texture.enabled = true;
    bevel.texture.pattern = { id: 'woven', name: 'Woven', assetId: 'asset-woven' };
    const values = layerStyleUniform(bevel, stack, 320, 240, false);
    expect(values?.[0]).toBe(9);
    expect(values?.[24]).toBe(0);
  });

  it.each([
    'drop-shadow',
    'inner-shadow',
    'outer-glow',
    'inner-glow',
    'stroke',
    'gradient-overlay',
    'satin',
    'bevel-emboss',
    'color-overlay'
  ] as const)('packs finite normalized settings for %s', (kind) => {
    const values = layerStyleUniform(
      createDefaultLayerStyle(kind),
      createDefaultLayerStyleStack(),
      1920,
      1080
    );
    expect(values).not.toBeNull();
    expect([...values!].every(Number.isFinite)).toBe(true);
    expect(values![1]).toBeGreaterThan(0);
    expect(values![1]).toBeLessThanOrEqual(1);
  });

  it('packs the complete Bevel & Emboss geometry and lighting contract', () => {
    const bevel = createDefaultLayerStyle('bevel-emboss');
    if (bevel.kind !== 'bevel-emboss') throw new Error('Expected Bevel defaults.');
    bevel.style = 'pillow-emboss';
    bevel.technique = 'chisel-soft';
    bevel.altitude = 41;
    bevel.soften = 3;
    bevel.depth = 2.5;
    const stack = createDefaultLayerStyleStack();
    stack.scale = 2;
    const values = layerStyleUniform(bevel, stack, 640, 480)!;
    expect(values[0]).toBe(9);
    expect(values[3]).toBe(2);
    expect(values[13]).toBe(41);
    expect(values[14]).toBe(10);
    expect(values[15]).toBe(2.5);
    expect(values[18]).toBe(6);
    expect(values[19]).toBe(3);
  });

  it('uses the shared pattern registry contract for Bevel Texture', () => {
    const bevel = createDefaultLayerStyle('bevel-emboss');
    if (bevel.kind !== 'bevel-emboss') throw new Error('Expected Bevel defaults.');
    bevel.texture = {
      enabled: true,
      pattern: { id: 'woven', name: 'Woven', assetId: 'asset-woven' },
      scale: 1.25,
      depth: -0.8,
      invert: true,
      linkWithLayer: true
    };
    const values = layerStyleUniform(bevel, createDefaultLayerStyleStack(), 640, 480)!;
    expect(values[24]).toBe(1);
    expect(values[25]).toBeCloseTo(1.25);
    expect(values[26]).toBeCloseTo(-0.8);
    expect(values[27]).toBe(1);
  });

  it.each([
    ['pattern-overlay', 13],
    ['stroke', 14]
  ] as const)('renders resolved pattern-backed %s styles', (kind, expectedKind) => {
    const effect = createDefaultLayerStyle(kind);
    if (effect.kind === 'pattern-overlay') {
      effect.pattern = { id: 'pattern', name: 'Pattern', assetId: 'asset-pattern' };
      effect.angle = 25;
      effect.scale = 1.5;
    } else if (effect.kind === 'stroke') {
      effect.fill = {
        type: 'pattern',
        pattern: { id: 'pattern', name: 'Pattern', assetId: 'asset-pattern' },
        scale: 1.5,
        angle: 25
      };
    }
    const values = layerStyleUniform(effect, createDefaultLayerStyleStack(), 320, 240);
    expect(values?.[0]).toBe(expectedKind);
    expect(values?.[12]).toBe(25);
    expect(values?.[14]).toBe(1.5);
  });

  it('packs ordered multi-stop gradients and their opacity stops', () => {
    const stack = createDefaultLayerStyleStack();
    const gradient = createDefaultLayerStyle('gradient-overlay');
    if (gradient.kind !== 'gradient-overlay') throw new Error('Expected Gradient Overlay defaults.');
    gradient.gradient.colorStops.reverse();
    gradient.gradient.opacityStops[0].opacity = 0.25;
    const values = layerStyleUniform(gradient, stack, 1920, 1080)!;

    expect(values).toHaveLength(LAYER_STYLE_SETTINGS_FLOATS);
    expect(values[0]).toBe(7);
    expect(values[8]).toBe(2);
    expect(values[9]).toBe(2);
    expect(values[27]).toBe(0);
    expect(values[31]).toBe(1);
    expect(values[56]).toBe(0);
    expect(values[57]).toBe(0.25);
    expect(values[60]).toBe(1);
    expect(values[61]).toBe(1);
  });

  it('renders gradient strokes instead of silently dropping the effect', () => {
    const stack = createDefaultLayerStyleStack();
    const stroke = createDefaultLayerStyle('stroke');
    if (stroke.kind !== 'stroke') throw new Error('Expected Stroke defaults.');
    const gradient = createDefaultLayerStyle('gradient-overlay');
    if (gradient.kind !== 'gradient-overlay') throw new Error('Expected Gradient Overlay defaults.');
    stroke.size = 12;
    stroke.position = 'center';
    stroke.fill = {
      type: 'gradient',
      gradient: gradient.gradient,
      dither: true,
      reverse: true,
      style: 'radial',
      alignWithLayer: true,
      angle: 45,
      scale: 1.25,
      offsetX: 0.1,
      offsetY: -0.2,
      method: 'perceptual'
    };

    const values = layerStyleUniform(stroke, stack, 800, 600)!;
    expect(values[0]).toBe(10);
    expect(values[3]).toBe(12);
    expect(values[8]).toBe(2);
    expect(values[12]).toBe(45);
    expect(values[13]).toBeCloseTo(0.1);
    expect(values[14]).toBeCloseTo(1.25);
    expect(values[15]).toBeCloseTo(-0.2);
    expect([...values.slice(16, 20)]).toEqual([2, 1, 1, 1]);
  });

  it.each([
    ['outer-glow', 11],
    ['inner-glow', 12]
  ] as const)('packs editable gradient-backed %s effects', (kind, expectedKind) => {
    const effect = createDefaultLayerStyle(kind);
    if (effect.kind !== kind) throw new Error(`Expected ${kind} defaults.`);
    effect.gradient = createDefaultLayerStyleGradient();
    effect.gradient.opacityStops[1].opacity = 0.4;
    const values = layerStyleUniform(effect, createDefaultLayerStyleStack(), 800, 600)!;
    expect(values[0]).toBe(expectedKind);
    expect(values[8]).toBe(2);
    expect(values[9]).toBe(2);
    expect(values[61]).toBeCloseTo(0.4);
    expect([...values.slice(120, 122)]).toEqual([0, 0]);
    expect([...values.slice(124, 126)]).toEqual([1, 1]);
  });
});
