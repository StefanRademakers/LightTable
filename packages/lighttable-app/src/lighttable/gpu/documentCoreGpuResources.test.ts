import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createDefaultAdjustments } from '../types';
import { DocumentCoreGpuResources } from './documentCoreGpuResources';

beforeAll(() => {
  vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2 });
  vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 4, COPY_DST: 8 });
});

const createDevice = () => {
  const buffers: Array<{ destroy: ReturnType<typeof vi.fn> }> = [];
  const textures: Array<{ destroy: ReturnType<typeof vi.fn> }> = [];
  const device = {
    queue: {
      writeBuffer: vi.fn(),
      writeTexture: vi.fn()
    },
    createSampler: vi.fn(() => ({ kind: 'sampler' })),
    createBuffer: vi.fn(() => {
      const buffer = { destroy: vi.fn() };
      buffers.push(buffer);
      return buffer;
    }),
    createTexture: vi.fn(() => {
      const texture = { destroy: vi.fn() };
      textures.push(texture);
      return texture;
    })
  } as unknown as GPUDevice;
  return { device, buffers, textures };
};

describe('DocumentCoreGpuResources', () => {
  it('owns and idempotently destroys its complete resource bundle', () => {
    const { device, buffers, textures } = createDevice();
    const resources = new DocumentCoreGpuResources(device);

    expect(device.createSampler).toHaveBeenCalledTimes(2);
    expect(device.createBuffer).toHaveBeenCalledTimes(6);
    expect(device.createTexture).toHaveBeenCalledTimes(2);

    resources.destroy();
    resources.destroy();

    buffers.forEach((buffer) => expect(buffer.destroy).toHaveBeenCalledTimes(1));
    textures.forEach((texture) => expect(texture.destroy).toHaveBeenCalledTimes(1));
  });

  it('retains equal viewport-independent output settings', () => {
    const { device } = createDevice();
    const resources = new DocumentCoreGpuResources(device);
    const initialWrites = vi.mocked(device.queue.writeBuffer).mock.calls.length;

    expect(resources.writeOutputSettings(new Float32Array([1, 2, 3]))).toBe(true);
    expect(resources.writeOutputSettings(new Float32Array([1, 2, 3]))).toBe(false);
    expect(resources.writeOutputSettings(new Float32Array([1, 2, 4]))).toBe(true);
    expect(device.queue.writeBuffer).toHaveBeenCalledTimes(initialWrites + 2);
  });

  it('publishes adjustment payloads through the owned uniform and curve targets', () => {
    const { device } = createDevice();
    const resources = new DocumentCoreGpuResources(device);
    const adjustments = createDefaultAdjustments();
    vi.mocked(device.queue.writeBuffer).mockClear();
    vi.mocked(device.queue.writeTexture).mockClear();

    resources.syncAdjustments(adjustments, 1920, 1080, false);
    resources.syncAdjustments(adjustments, 1920, 1080, false);

    expect(device.queue.writeBuffer).toHaveBeenCalledTimes(1);
    expect(device.queue.writeTexture).toHaveBeenCalledTimes(1);
  });
});
