import { describe, expect, it } from 'vitest';
import { LAYER_STYLE_EFFECT_WGSL } from './layerShaders';

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
