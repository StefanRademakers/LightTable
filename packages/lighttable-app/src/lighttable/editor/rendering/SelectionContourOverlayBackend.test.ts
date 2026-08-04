import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SELECTION_CONTOUR_WGSL,
  SelectionContourOverlayBackend
} from './SelectionContourOverlayBackend';

beforeEach(() => {
  vi.stubGlobal('GPUShaderStage', { VERTEX: 1, FRAGMENT: 2 });
  vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2 });
});

describe('SelectionContourOverlayBackend', () => {
  it('keeps the ants uniform contract aligned to one 16-byte vec4', () => {
    const destroy = vi.fn();
    const device = {
      createShaderModule: vi.fn(() => ({})),
      createRenderPipeline: vi.fn(() => ({})),
      createBuffer: vi.fn(() => ({ destroy }))
    };

    const backend = new SelectionContourOverlayBackend(
      device as unknown as GPUDevice,
      'rgba8unorm'
    );

    expect(SELECTION_CONTOUR_WGSL).toContain('phasePadding: vec4f');
    expect(device.createBuffer).toHaveBeenCalledWith(expect.objectContaining({ size: 16 }));
    backend.dispose();
    expect(destroy).toHaveBeenCalledOnce();
  });
});
