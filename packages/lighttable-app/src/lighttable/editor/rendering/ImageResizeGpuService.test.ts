import { describe, expect, it } from 'vitest';
// @ts-expect-error The package declaration describes this ESM implementation.
import { WgslReflect } from 'wgsl_reflect/wgsl_reflect.module.js';
import { IMAGE_RESIZE_WGSL } from './ImageResizeGpuService';

describe('Image Resize GPU shader', () => {
  it('has a valid shared nearest, bilinear, cubic and detail-preserving shader contract', () => {
    expect(() => new WgslReflect(IMAGE_RESIZE_WGSL)).not.toThrow();
    expect(IMAGE_RESIZE_WGSL).toContain('((destination + vec2f(0.5))');
    expect(IMAGE_RESIZE_WGSL).toContain('textureLoad');
    expect(IMAGE_RESIZE_WGSL).toContain('bicubic(source');
  });
});
