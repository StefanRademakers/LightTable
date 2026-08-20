import { describe, expect, it } from 'vitest';
// @ts-expect-error The package declaration describes this ESM implementation.
import { WgslReflect } from 'wgsl_reflect/wgsl_reflect.module.js';
import { DOCUMENT_GEOMETRY_MASK_WGSL } from './DocumentGeometryGpuService';

describe('Document Geometry GPU shader', () => {
  it('uses one valid inverse mapping for exact and filtered mask transfers', () => {
    const reflection = new WgslReflect(DOCUMENT_GEOMETRY_MASK_WGSL);
    expect(DOCUMENT_GEOMETRY_MASK_WGSL).toContain('destinationCenter');
    expect(DOCUMENT_GEOMETRY_MASK_WGSL).toContain('textureLoad');
    expect(DOCUMENT_GEOMETRY_MASK_WGSL).toContain('textureSampleLevel');
    expect(reflection.uniforms[0]?.type.size).toBe(64);
  });
});
