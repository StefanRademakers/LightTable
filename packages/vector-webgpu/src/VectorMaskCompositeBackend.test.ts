import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VECTOR_MASK_COMPOSITE_WGSL } from './VectorMaskCompositeBackend';
import { VectorMaskCompositeBackend } from './VectorMaskCompositeBackend';

beforeEach(() => {
  vi.stubGlobal('GPUShaderStage', { FRAGMENT: 2 });
  vi.stubGlobal('GPUTextureUsage', { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2 });
});

describe('VectorMaskCompositeBackend', () => {
  it('multiplies every premultiplied content channel by vector coverage', () => {
    expect(VECTOR_MASK_COMPOSITE_WGSL).toContain('let coverage = textureLoad(maskTexture');
    expect(VECTOR_MASK_COMPOSITE_WGSL).toContain('return content * coverage;');
  });

  it('owns a reusable target and disposes it idempotently', () => {
    const destroy = vi.fn();
    const view = {} as GPUTextureView;
    const texture = { createView: vi.fn(() => view), destroy };
    const device = {
      createBindGroupLayout: vi.fn(() => ({})),
      createTexture: vi.fn(() => texture)
    } as unknown as GPUDevice;
    const backend = new VectorMaskCompositeBackend(device);

    const surface = backend.createSurface(320, 180);
    expect(surface).toMatchObject({ width: 320, height: 180, format: 'rgba16float', view });
    expect((device.createTexture as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      expect.objectContaining({
        size: { width: 320, height: 180 },
        usage: 3
      })
    );

    surface.dispose();
    surface.dispose();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
