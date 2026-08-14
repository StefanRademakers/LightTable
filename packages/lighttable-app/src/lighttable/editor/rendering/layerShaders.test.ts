import { describe, expect, it } from 'vitest';
import { COLOR_CHANNEL_COPY_WGSL, LAYER_STYLE_EFFECT_WGSL } from './layerShaders';

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
});

describe('layer transparency selection shader contract', () => {
  it('supports intrinsic alpha independently from composite luminance', () => {
    expect(COLOR_CHANNEL_COPY_WGSL).toContain('if (settings.channel == 4u) { value = source.a; }');
    expect(COLOR_CHANNEL_COPY_WGSL).toContain(
      'value = dot(color, vec3f(0.2126, 0.7152, 0.0722));'
    );
  });
});
