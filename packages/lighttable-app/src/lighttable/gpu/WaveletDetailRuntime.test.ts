import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultDetail } from '../detail';
import { WaveletDetailRuntime } from './WaveletDetailRuntime';

describe('WaveletDetailRuntime', () => {
  beforeEach(() => {
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2 });
    vi.stubGlobal('GPUTextureUsage', { RENDER_ATTACHMENT: 4, TEXTURE_BINDING: 8 });
  });

  const createHarness = () => {
    const textures: Array<{ createView: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }> = [];
    const pipeline = { getBindGroupLayout: vi.fn(() => ({})) } as unknown as GPURenderPipeline;
    const device = {
      queue: { writeBuffer: vi.fn() },
      createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
      createShaderModule: vi.fn(() => ({})),
      createRenderPipeline: vi.fn(() => pipeline),
      createTexture: vi.fn(() => {
        const texture = { createView: vi.fn(() => ({})), destroy: vi.fn() };
        textures.push(texture);
        return texture;
      }),
      createBindGroup: vi.fn(() => ({}))
    } as unknown as GPUDevice;
    const runtime = new WaveletDetailRuntime(device, {} as GPUSampler, {} as GPUShaderModule);
    const draw = vi.fn();
    const pass = {
      setPipeline: vi.fn(), setBindGroup: vi.fn(), draw, end: vi.fn()
    };
    const encoder = { beginRenderPass: vi.fn(() => pass) } as unknown as GPUCommandEncoder;
    const source = { createView: vi.fn(() => ({})) } as unknown as GPUTexture;
    return { device, runtime, encoder, source, textures, draw };
  };

  it('is a zero-allocation bypass while noise reduction is neutral', () => {
    const harness = createHarness();
    harness.runtime.configure(1920, 1080);

    expect(harness.runtime.encode(
      harness.encoder,
      harness.source,
      {} as GPUBuffer,
      createDefaultDetail()
    )).toBe(harness.source);
    expect(harness.device.createTexture).not.toHaveBeenCalled();
    expect(harness.device.createRenderPipeline).not.toHaveBeenCalled();
    expect(harness.runtime.estimatedTextureBytes()).toBe(0);
  });

  it('encodes four horizontal and four shrink passes into retained 16-bit scratch', () => {
    const harness = createHarness();
    harness.runtime.configure(320, 200);
    const detail = createDefaultDetail();
    detail.luminanceNoiseReduction = 50;

    expect(harness.runtime.encode(
      harness.encoder,
      harness.source,
      {} as GPUBuffer,
      detail
    )).not.toBe(harness.source);
    expect(harness.device.createTexture).toHaveBeenCalledTimes(3);
    expect(harness.device.createRenderPipeline).toHaveBeenCalledTimes(2);
    expect(harness.draw).toHaveBeenCalledTimes(8);
    expect(harness.runtime.estimatedTextureBytes()).toBe(320 * 200 * 8 * 3);
  });
});
