import { describe, expect, it } from 'vitest';
import { WgslReflect } from 'wgsl_reflect/wgsl_reflect.module.js';
import { COVERAGE_ATLAS_WGSL } from './coverageShader';
import { HB_GPU_DRAW_WGSL, HB_GPU_SOURCE_REVISION } from './hbGpuShader.generated';

describe('text renderer bakeoff WGSL', () => {
  it('reflects the bounded R8 atlas entry points and bindings', () => {
    expect(() => new WgslReflect(COVERAGE_ATLAS_WGSL)).not.toThrow();
    expect(COVERAGE_ATLAS_WGSL).toContain('@vertex fn coverageVertex');
    expect(COVERAGE_ATLAS_WGSL).toContain('@fragment fn coverageFragment');
    expect(COVERAGE_ATLAS_WGSL).toMatch(/@group\(0\) @binding\([0-3]\)/g);
    expect(COVERAGE_ATLAS_WGSL).toContain('texture_2d<f32>');
  });

  it('vendors the pinned upstream hb-gpu Slug shader with LightTable entry points', () => {
    expect(HB_GPU_SOURCE_REVISION).toMatch(/^[a-f0-9]{40}$/);
    expect(HB_GPU_DRAW_WGSL).toContain('fn _hb_gpu_slug');
    expect(HB_GPU_DRAW_WGSL).toContain('fn hb_gpu_draw');
    expect(HB_GPU_DRAW_WGSL).toContain('@vertex fn lighttable_hb_gpu_vertex');
    expect(HB_GPU_DRAW_WGSL).toContain('@fragment fn lighttable_hb_gpu_fragment');
    expect(HB_GPU_DRAW_WGSL).toContain('@group(0) @binding(1) var<storage, read> hb_gpu_atlas');
  });
});
