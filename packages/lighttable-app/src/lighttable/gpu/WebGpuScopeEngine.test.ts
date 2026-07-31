import { describe, expect, it } from 'vitest';
import { webGpuScopeOptionsEqual, type WebGpuScopeOptions } from './WebGpuScopeEngine';

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
