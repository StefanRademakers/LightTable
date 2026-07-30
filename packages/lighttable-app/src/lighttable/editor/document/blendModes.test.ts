import { describe, expect, it } from 'vitest';
import { BLEND_MODES, blendModeGpuValue } from './blendModes';

describe('LightTable blend mode registry', () => {
  it('has stable unique ids and GPU values', () => {
    expect(new Set(BLEND_MODES.map((mode) => mode.id)).size).toBe(BLEND_MODES.length);
    expect(new Set(BLEND_MODES.map((mode) => mode.gpuValue)).size).toBe(BLEND_MODES.length);
    expect(blendModeGpuValue('normal')).toBe(0);
    expect(blendModeGpuValue('luminosity')).toBe(15);
  });
});
