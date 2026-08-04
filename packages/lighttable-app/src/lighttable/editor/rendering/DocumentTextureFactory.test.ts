import { describe, expect, it, vi } from 'vitest';
import { DocumentTextureFactory } from './DocumentTextureFactory';

const installGpuUsage = () => {
  vi.stubGlobal('GPUTextureUsage', {
    TEXTURE_BINDING: 1,
    RENDER_ATTACHMENT: 2,
    COPY_SRC: 4,
    COPY_DST: 8
  });
};

describe('DocumentTextureFactory', () => {
  it('creates color and selection textures with current clamped dimensions', () => {
    installGpuUsage();
    const createTexture = vi.fn((descriptor) => descriptor);
    const factory = new DocumentTextureFactory({
      device: { createTexture } as unknown as GPUDevice,
      dimensions: () => ({ width: 0, height: 72 })
    });

    factory.createColor('color');
    factory.createSelection('selection');

    expect(createTexture).toHaveBeenNthCalledWith(1, expect.objectContaining({
      label: 'color',
      size: [1, 72],
      format: 'rgba16float',
      usage: 15
    }));
    expect(createTexture).toHaveBeenNthCalledWith(2, expect.objectContaining({
      label: 'selection',
      size: [1, 72],
      format: 'r8unorm',
      usage: 15
    }));
  });

  it('initializes masks to opaque white before publishing them', () => {
    installGpuUsage();
    const end = vi.fn();
    const beginRenderPass = vi.fn(() => ({ end }));
    const finish = vi.fn(() => ({}) as GPUCommandBuffer);
    const submit = vi.fn();
    const texture = { createView: vi.fn(() => ({})) } as unknown as GPUTexture;
    const createTexture = vi.fn(() => texture);
    const factory = new DocumentTextureFactory({
      device: {
        createTexture,
        createCommandEncoder: vi.fn(() => ({ beginRenderPass, finish })),
        queue: { submit }
      } as unknown as GPUDevice,
      dimensions: () => ({ width: 32, height: 16 })
    });

    expect(factory.createMask('mask')).toBe(texture);
    expect(createTexture).toHaveBeenCalledWith(expect.objectContaining({
      label: 'mask',
      size: [32, 16],
      format: 'r8unorm'
    }));
    expect(beginRenderPass).toHaveBeenCalledWith({
      colorAttachments: [{
        view: expect.anything(),
        clearValue: { r: 1, g: 1, b: 1, a: 1 },
        loadOp: 'clear',
        storeOp: 'store'
      }]
    });
    expect(end).toHaveBeenCalledOnce();
    expect(finish).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledOnce();
  });

  it('encodes a fullscreen triangle through one primitive draw boundary', () => {
    const setPipeline = vi.fn();
    const setBindGroup = vi.fn();
    const draw = vi.fn();
    const end = vi.fn();
    const beginRenderPass = vi.fn(() => ({
      setPipeline,
      setBindGroup,
      draw,
      end
    }));
    const factory = new DocumentTextureFactory({
      device: {} as GPUDevice,
      dimensions: () => ({ width: 1, height: 1 })
    });
    const encoder = { beginRenderPass } as unknown as GPUCommandEncoder;
    const pipeline = {} as GPURenderPipeline;
    const bindGroup = {} as GPUBindGroup;
    const target = {} as GPUTextureView;
    const clearValue = { r: 0, g: 0, b: 0, a: 0 };

    factory.drawFullscreen(encoder, pipeline, bindGroup, target, clearValue);

    expect(setPipeline).toHaveBeenCalledWith(pipeline);
    expect(setBindGroup).toHaveBeenCalledWith(0, bindGroup);
    expect(draw).toHaveBeenCalledWith(3);
    expect(end).toHaveBeenCalledOnce();
  });

  it('publishes selection targets only after their canonical clear state is submitted', () => {
    const end = vi.fn();
    const beginRenderPass = vi.fn(() => ({ end }));
    const finish = vi.fn(() => ({}) as GPUCommandBuffer);
    const submit = vi.fn();
    const factory = new DocumentTextureFactory({
      device: {
        createCommandEncoder: vi.fn(() => ({ beginRenderPass, finish })),
        queue: { submit }
      } as unknown as GPUDevice,
      dimensions: () => ({ width: 1, height: 1 })
    });
    const texture = () => ({
      createView: vi.fn(() => ({}))
    }) as unknown as GPUTexture;

    factory.initializeSelectionTargets(texture(), texture(), texture());

    expect(beginRenderPass).toHaveBeenCalledTimes(3);
    expect(beginRenderPass).toHaveBeenNthCalledWith(1, expect.objectContaining({
      colorAttachments: [expect.objectContaining({
        clearValue: { r: 1, g: 0, b: 0, a: 1 }
      })]
    }));
    expect(beginRenderPass).toHaveBeenNthCalledWith(3, expect.objectContaining({
      colorAttachments: [expect.objectContaining({
        clearValue: { r: 0, g: 0, b: 0, a: 0 }
      })]
    }));
    expect(end).toHaveBeenCalledTimes(3);
    expect(finish).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledOnce();
  });
});
