import { describe, expect, it } from 'vitest';
import {
  scopeCanvasVisibilityEqual,
  scopeCanvasVisibilityHasAny,
  webGpuScopeOptionsEqual,
  type ScopeCanvasVisibility,
  type WebGpuScopeOptions
} from './WebGpuScopeEngine';

const options: WebGpuScopeOptions = {
  hueDistributionVisible: true,
  paradeVisible: true,
  vectorscopeVisible: true,
  quality: 'medium',
  traceBrightness: 0.8,
  vectorscopeRange: 'all',
  vectorscopeZoom2x: false
};

describe('WebGPU scope option state', () => {
  it('recognizes semantically identical option objects', () => {
    expect(webGpuScopeOptionsEqual(options, { ...options })).toBe(true);
  });

  it('detects analysis and display option changes', () => {
    expect(webGpuScopeOptionsEqual(options, {
      ...options,
      vectorscopeRange: 'high'
    })).toBe(false);
    expect(webGpuScopeOptionsEqual(options, {
      ...options,
      traceBrightness: 0.5
    })).toBe(false);
  });
});

describe('WebGPU scope canvas visibility', () => {
  const hidden: ScopeCanvasVisibility = {
    hueDistribution: false,
    colorMixerHueDistribution: false,
    parade: false,
    vectorscope: false
  };

  it('does not schedule optional scope work when every canvas is hidden', () => {
    expect(scopeCanvasVisibilityHasAny(hidden)).toBe(false);
  });

  it('treats the compact Color Mixer as a visible hue-analysis consumer', () => {
    const mixerVisible = {
      ...hidden,
      colorMixerHueDistribution: true
    };
    expect(scopeCanvasVisibilityHasAny(mixerVisible)).toBe(true);
    expect(scopeCanvasVisibilityEqual(hidden, mixerVisible)).toBe(false);
    expect(scopeCanvasVisibilityEqual(mixerVisible, { ...mixerVisible })).toBe(true);
  });
});
