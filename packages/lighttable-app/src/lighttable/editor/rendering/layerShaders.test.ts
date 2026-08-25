import { describe, expect, it } from 'vitest';
import {
  COLOR_CHANNEL_COPY_WGSL,
  LAYER_EXPORT_WGSL,
  LAYER_STYLE_BEVEL_BLUR_WGSL,
  LAYER_STYLE_BEVEL_FLOOD_WGSL,
  LAYER_STYLE_BEVEL_SEED_WGSL,
  LAYER_STYLE_EFFECT_WGSL,
  LAYER_STYLE_GAUSSIAN_BLUR_WGSL
} from './layerShaders';

describe('layer export color contract', () => {
  it('keeps Copy Merged straight-sRGB pixels out of the canonical layer conversion', () => {
    expect(LAYER_EXPORT_WGSL).toContain('sourceIsStraightSrgb: f32');
    expect(LAYER_EXPORT_WGSL).toContain('if (settings.sourceIsStraightSrgb > 0.5)');
    expect(LAYER_EXPORT_WGSL).toContain('return clamp(sampled, vec4f(0.0), vec4f(1.0));');
  });

  it('still converts canonical premultiplied linear layers to straight sRGB', () => {
    expect(LAYER_EXPORT_WGSL).toContain('let straight = sampled.rgb / max(sampled.a, 1e-6);');
    expect(LAYER_EXPORT_WGSL).toContain('linearToSrgbChannel(straight.r)');
  });
});

describe('layer style effect shader contract', () => {
  it('casts Photoshop-compatible drop shadows away from the stored light angle', () => {
    expect(LAYER_STYLE_EFFECT_WGSL).toContain(
      'shapedCoverage(blurredAlpha(input.uv, offset, radius), choke, noise, pixel, true)'
    );
    expect(LAYER_STYLE_EFFECT_WGSL).toContain(
      'let absent = 1.0 - blurredAlpha(input.uv, offset, radius)'
    );
  });

  it('splits the authored center-stroke width across both sides of the edge', () => {
    expect(LAYER_STYLE_EFFECT_WGSL).toContain(
      'select(radius, radius * 0.5, position >= 1.5)'
    );
  });

  it('derives bevel normals from a fixed Sobel footprint instead of the authored radius', () => {
    expect(LAYER_STYLE_EFFECT_WGSL).toContain(
      'let tl = bevelHeightAt(input.uv, vec2i(-1, -1), radius, style, technique);'
    );
    expect(LAYER_STYLE_EFFECT_WGSL).toContain(
      '(-tl - 2.0 * ml - bl + tr + 2.0 * mr + br) / 8.0'
    );
    expect(LAYER_STYLE_EFFECT_WGSL).toContain('-normal * depth * 64.0');
    expect(LAYER_STYLE_EFFECT_WGSL).not.toContain('normalStep');
    expect(LAYER_STYLE_EFFECT_WGSL).toContain(
      'normal = smoothHeightGradientAt(input.uv).yz;'
    );
  });

  it('keeps smooth matte bevels valid independently of the chisel distance field', () => {
    expect(LAYER_STYLE_EFFECT_WGSL).toContain('if (technique < 0.5) {');
    expect(LAYER_STYLE_EFFECT_WGSL).toContain('if (style == 1 || style == 3) { return center; }');
    expect(LAYER_STYLE_EFFECT_WGSL).toContain(
      'bevelCoverageAt(input.uv, max(radius + soften, 0.5), style, technique)'
    );
  });

  it('uses anti-aliased alpha coverage to initialize the retained bevel distance field', () => {
    expect(LAYER_STYLE_BEVEL_SEED_WGSL).toContain('let center = alpha[4];');
    expect(LAYER_STYLE_BEVEL_SEED_WGSL).toContain('let gradient = vec2f(');
    expect(LAYER_STYLE_BEVEL_SEED_WGSL).toContain(
      'let coverageDistance = clamp((0.5 - center) / max(magnitude, 1.0), -0.75, 0.75);'
    );
  });

  it('never spreads a fixed tap budget across a wide Smooth Bevel radius', () => {
    expect(LAYER_STYLE_BEVEL_BLUR_WGSL).toContain(
      'for (var tap = 1; tap <= 100; tap += 1)'
    );
    expect(LAYER_STYLE_BEVEL_BLUR_WGSL).toContain(
      'let weight = exp(-(offset * offset) / denominator) * taper;'
    );
    expect(LAYER_STYLE_BEVEL_BLUR_WGSL).not.toContain('gaussianKernel');
    expect(LAYER_STYLE_BEVEL_BLUR_WGSL).toContain(
      'return alphaLoad(vec2i(floor(sourcePixel)));'
    );
    expect(LAYER_STYLE_GAUSSIAN_BLUR_WGSL).toContain('gaussianKernel');
  });

  it('bounds jump flooding to the authored bevel support', () => {
    expect(LAYER_STYLE_BEVEL_FLOOD_WGSL).toContain(
      'squared <= settings.maximumDistance * settings.maximumDistance'
    );
    expect(LAYER_STYLE_BEVEL_FLOOD_WGSL).toContain(
      'return vec4f(bestVector, center.z, select(0.0, 1.0, bestSquared < 1e19));'
    );
  });
});

describe('layer transparency selection shader contract', () => {
  it('supports intrinsic alpha independently from composite luminance', () => {
    expect(COLOR_CHANNEL_COPY_WGSL).toContain('if (settings.channel == 4u) { value = source.a; }');
    expect(COLOR_CHANNEL_COPY_WGSL).toContain(
      'value = dot(color, vec3f(0.2126, 0.7152, 0.0722));'
    );
  });
});
