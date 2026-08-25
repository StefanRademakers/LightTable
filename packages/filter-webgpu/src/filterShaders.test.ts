import { describe, expect, it } from 'vitest';
import { BLUR_CORE_WGSL, FILTER_FULLSCREEN_VERTEX_WGSL } from './filterShaders';

describe('filter shaders', () => {
  it('keeps BlurCore bindings stable and avoids WGSL reserved identifiers', () => {
    expect(`${FILTER_FULLSCREEN_VERTEX_WGSL}\n${BLUR_CORE_WGSL}`).not.toMatch(/\bfilter\s*[:;]/);
    expect(BLUR_CORE_WGSL).toContain('outputMode');
    expect(BLUR_CORE_WGSL).toContain('perceptualDifference');
  });
});
