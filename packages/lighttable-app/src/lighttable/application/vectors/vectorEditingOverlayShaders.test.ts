import { describe, expect, it } from 'vitest';
// The package's ESM entry is not exposed through package exports, so tests import it directly.
// @ts-expect-error The public declaration belongs to the package root and describes this same class.
import { WgslReflect } from 'wgsl_reflect/wgsl_reflect.module.js';
import {
  VECTOR_EDITING_OVERLAY_LINE_WGSL,
  VECTOR_EDITING_OVERLAY_MARKER_WGSL
} from '@lighttable/vector-webgpu';

describe('vector editing overlay shaders', () => {
  it('parses the cubic line shader as standalone WGSL', () => {
    expect(() => new WgslReflect(VECTOR_EDITING_OVERLAY_LINE_WGSL)).not.toThrow();
  });

  it('parses the screen-space marker shader as standalone WGSL', () => {
    expect(() => new WgslReflect(VECTOR_EDITING_OVERLAY_MARKER_WGSL)).not.toThrow();
  });
});
