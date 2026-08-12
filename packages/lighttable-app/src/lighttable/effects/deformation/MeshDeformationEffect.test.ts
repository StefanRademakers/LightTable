import { describe, expect, it } from 'vitest';
// @ts-expect-error The public declaration describes this package-internal ESM entry.
import { WgslReflect } from 'wgsl_reflect/wgsl_reflect.module.js';
import { FULLSCREEN_VERTEX_WGSL } from '../../gpu/shaders';
import {
  changedFloatRange,
  MESH_DEFORMATION_BASE_FRAGMENT_WGSL,
  MESH_DEFORMATION_WGSL,
  planDeformationUpload
} from './MeshDeformationEffect';

describe('indexed mesh deformation shaders', () => {
  it('keeps the fullscreen copy and indexed source/target shaders valid WGSL', () => {
    expect(() => new WgslReflect(
      `${FULLSCREEN_VERTEX_WGSL}\n${MESH_DEFORMATION_BASE_FRAGMENT_WGSL}`
    )).not.toThrow();
    expect(() => new WgslReflect(MESH_DEFORMATION_WGSL)).not.toThrow();
  });
});

describe('mesh deformation target uploads', () => {
  it('returns no upload for an unchanged target', () => {
    expect(changedFloatRange(
      new Float32Array([1, 2, 3, 4]),
      new Float32Array([1, 2, 3, 4])
    )).toBeNull();
  });

  it('bounds an interactive upload to the changed target vertices', () => {
    expect(changedFloatRange(
      new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]),
      new Float32Array([1, 2, 30, 40, 5, 6, 70, 8, 9])
    )).toEqual({ start: 2, end: 7 });
  });

  it('uploads the complete target after its allocation size changes', () => {
    expect(changedFloatRange(
      new Float32Array([1, 2, 3]),
      new Float32Array([1, 2, 3, 4, 5, 6])
    )).toEqual({ start: 0, end: 6 });
  });

  it('keeps immutable source and index buffers for target-only interaction', () => {
    expect(planDeformationUpload(
      'source:7:468:2556',
      'source:7:468:2556',
      new Float32Array([10, 20, 0.5, 30, 40, 0.5]),
      new Float32Array([10, 20, 0.5, 34, 44, 0.5])
    )).toEqual({
      topologyChanged: false,
      targetRange: { start: 3, end: 5 }
    });
  });
});
