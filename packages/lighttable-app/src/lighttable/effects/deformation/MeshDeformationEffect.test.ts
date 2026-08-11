import { describe, expect, it } from 'vitest';
// @ts-expect-error The public declaration describes this package-internal ESM entry.
import { WgslReflect } from 'wgsl_reflect/wgsl_reflect.module.js';
import { FULLSCREEN_VERTEX_WGSL } from '../../gpu/shaders';
import {
  MESH_DEFORMATION_BASE_FRAGMENT_WGSL,
  MESH_DEFORMATION_WGSL
} from './MeshDeformationEffect';

describe('indexed mesh deformation shaders', () => {
  it('keeps the fullscreen copy and indexed source/target shaders valid WGSL', () => {
    expect(() => new WgslReflect(
      `${FULLSCREEN_VERTEX_WGSL}\n${MESH_DEFORMATION_BASE_FRAGMENT_WGSL}`
    )).not.toThrow();
    expect(() => new WgslReflect(MESH_DEFORMATION_WGSL)).not.toThrow();
  });
});
