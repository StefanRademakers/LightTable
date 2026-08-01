import { describe, expect, it } from 'vitest';
import { VECTOR_EDITING_OVERLAY_MARKER_WGSL } from './shaders';

describe('vector WebGPU shaders', () => {
  it('does not declare the WGSL-reserved active identifier in the editing overlay', () => {
    expect(VECTOR_EDITING_OVERLAY_MARKER_WGSL).not.toMatch(/\b(?:let|var)\s+active\b/);
    expect(VECTOR_EDITING_OVERLAY_MARKER_WGSL).toContain('let isActive =');
  });
});
