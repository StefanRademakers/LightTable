import { describe, expect, it } from 'vitest';
import { BLUR_CORE_WGSL, FILTER_FULLSCREEN_VERTEX_WGSL } from './filterShaders';
import { OFFSET_WGSL } from './OffsetCore';
import { MOTION_BLUR_WGSL } from './MotionBlurCore';
import {
  WAVELET_DENOISE_HORIZONTAL_WGSL,
  WAVELET_DENOISE_VERTICAL_WGSL
} from './WaveletDenoiseCore';
import { DISPLACE_WGSL } from './DisplaceCore';

describe('filter shaders', () => {
  it('keeps BlurCore bindings stable and avoids WGSL reserved identifiers', () => {
    expect(`${FILTER_FULLSCREEN_VERTEX_WGSL}\n${BLUR_CORE_WGSL}`).not.toMatch(/\bfilter\s*[:;]/);
    expect(BLUR_CORE_WGSL).toContain('outputMode');
    expect(BLUR_CORE_WGSL).toContain('perceptualDifference');
  });

  it('preserves HDR headroom instead of clipping premultiplied RGB to alpha', () => {
    expect(BLUR_CORE_WGSL).not.toContain('vec3f(source.a)), source.a');
    expect(BLUR_CORE_WGSL).toContain('max(source.rgb + detail * gain, vec3f(0.0))');
  });

  it('keeps Offset edge handling explicit and free of external sampling state', () => {
    expect(OFFSET_WGSL).toContain('positiveMod');
    expect(OFFSET_WGSL).toContain('return vec4f(0.0)');
  });

  it('bounds Motion Blur work while retaining premultiplied HDR samples', () => {
    expect(MOTION_BLUR_WGSL).toContain('index < 257u');
    expect(MOTION_BLUR_WGSL).toContain('textureSampleLevel');
    expect(MOTION_BLUR_WGSL).not.toContain('clamp(accumulated');
  });

  it('keeps wavelet denoise multiscale, edge-protected and alpha-preserving', () => {
    expect(WAVELET_DENOISE_HORIZONTAL_WGSL).toContain('scale.step');
    expect(WAVELET_DENOISE_VERTICAL_WGSL).toContain('retainedDetail');
    expect(WAVELET_DENOISE_VERTICAL_WGSL).toContain('source.a');
  });

  it('keeps Displace map sampling bounded, explicit and HDR-capable', () => {
    expect(DISPLACE_WGSL).toContain('positiveMod');
    expect(DISPLACE_WGSL).toContain('bicubicSource');
    expect(DISPLACE_WGSL).toContain('mapSample.rgb / max(mapSample.a');
    expect(DISPLACE_WGSL).not.toContain('clamp(result, vec4f(0.0), vec4f(1.0))');
  });
});
