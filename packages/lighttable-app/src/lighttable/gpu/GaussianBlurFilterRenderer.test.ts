import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createAdjustmentLayer } from '../editor/document/documentTypes';
import { createGaussianBlurStack } from '../processing/gaussianBlurFilter';
import { createP0FilterStack } from '../processing/p0Filter';
import { GaussianBlurFilterRenderer } from './GaussianBlurFilterRenderer';

beforeAll(() => {
  vi.stubGlobal('GPUTextureUsage', { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2 });
  vi.stubGlobal('GPUBufferUsage', { UNIFORM: 4, COPY_DST: 8 });
});

const fixture = () => {
  const textures: Array<{ createView: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }> = [];
  const buffers: Array<{ destroy: ReturnType<typeof vi.fn> }> = [];
  const writeBuffer = vi.fn();
  const device = {
    queue: { writeBuffer },
    createTexture: vi.fn(() => {
      const texture = { createView: vi.fn(() => ({})), destroy: vi.fn() };
      textures.push(texture);
      return texture;
    }),
    createBuffer: vi.fn(() => {
      const buffer = { destroy: vi.fn() };
      buffers.push(buffer);
      return buffer;
    }),
    createShaderModule: vi.fn(() => ({})),
    createRenderPipeline: vi.fn(() => ({ getBindGroupLayout: vi.fn(() => ({})) })),
    createBindGroup: vi.fn(() => ({}))
  } as unknown as GPUDevice;
  const pass = {
    setPipeline: vi.fn(), setBindGroup: vi.fn(), draw: vi.fn(), end: vi.fn()
  };
  const encoder = { beginRenderPass: vi.fn(() => pass) } as unknown as GPUCommandEncoder;
  const renderer = new GaussianBlurFilterRenderer(device);
  renderer.configure(20, 10, {} as GPUSampler);
  return { renderer, device, encoder, textures, buffers, pass, writeBuffer };
};

describe('GaussianBlurFilterRenderer', () => {
  it('allocates lazily and encodes two separable full-frame passes', () => {
    const test = fixture();
    const layer = createAdjustmentLayer(
      createGaussianBlurStack(9, (kind) => kind), 'Gaussian Blur', 'gaussian-blur'
    );
    const source = { createView: vi.fn(() => ({})) } as unknown as GPUTexture;

    expect(test.renderer.estimatedTextureBytes()).toBe(0);
    expect(test.renderer.encode(test.encoder, source, layer)).not.toBe(source);
    expect(test.textures).toHaveLength(3);
    expect(test.renderer.estimatedTextureBytes()).toBe(20 * 10 * 8 * 3);
    expect(test.encoder.beginRenderPass).toHaveBeenCalledTimes(2);
    expect(test.pass.draw).toHaveBeenCalledTimes(2);
    expect(test.device.queue.writeBuffer).toHaveBeenCalledTimes(2);

    test.renderer.destroy();
    expect(test.textures.every(({ destroy }) => destroy.mock.calls.length === 1)).toBe(true);
    expect(test.buffers.every(({ destroy }) => destroy.mock.calls.length === 1)).toBe(true);
  });

  it('is an allocation-free exact bypass at radius zero', () => {
    const test = fixture();
    const layer = createAdjustmentLayer(
      createGaussianBlurStack(0, (kind) => kind), 'Gaussian Blur', 'gaussian-blur'
    );
    const source = {} as GPUTexture;

    expect(test.renderer.encode(test.encoder, source, layer)).toBe(source);
    expect(test.textures).toHaveLength(0);
    expect(test.encoder.beginRenderPass).not.toHaveBeenCalled();
  });

  it.each([
    ['high-pass', { radius: 12 }, 1],
    ['unsharp-mask', { amount: 125, radius: 2, threshold: 3 }, 2]
  ] as const)('routes %s through the shared BlurCore output mode', (kind, settings, outputMode) => {
    const test = fixture();
    const layer = createAdjustmentLayer(
      createP0FilterStack(kind, settings, (part) => `${kind}-${part}`), kind, kind
    );
    test.renderer.encode(test.encoder, { createView: vi.fn(() => ({})) } as unknown as GPUTexture, layer);
    const vertical = test.writeBuffer.mock.calls[1]?.[2] as ArrayBuffer;
    expect(new Uint32Array(vertical)[4]).toBe(outputMode);
    expect(test.encoder.beginRenderPass).toHaveBeenCalledTimes(2);
  });

  it('routes Offset through one exact integer-sampling pass and one retained target', () => {
    const test = fixture();
    const layer = createAdjustmentLayer(
      createP0FilterStack('offset', { horizontal: 12, vertical: -4, edgeMode: 'wrap' },
        (part) => `offset-${part}`),
      'Offset', 'offset'
    );
    const source = { createView: vi.fn(() => ({})) } as unknown as GPUTexture;
    expect(test.renderer.encode(test.encoder, source, layer)).not.toBe(source);
    expect(test.textures).toHaveLength(1);
    expect(test.encoder.beginRenderPass).toHaveBeenCalledOnce();
    const bytes = test.writeBuffer.mock.calls[0]?.[2] as ArrayBuffer;
    expect(Array.from(new Int32Array(bytes).slice(0, 2))).toEqual([12, -4]);
    expect(new Uint32Array(bytes)[2]).toBe(2);
  });

  it('bypasses a zero Offset without allocating GPU resources', () => {
    const test = fixture();
    const layer = createAdjustmentLayer(
      createP0FilterStack('offset', { horizontal: 0, vertical: 0, edgeMode: 'wrap' },
        (part) => `offset-${part}`),
      'Offset', 'offset'
    );
    const source = {} as GPUTexture;
    expect(test.renderer.encode(test.encoder, source, layer)).toBe(source);
    expect(test.textures).toHaveLength(0);
    expect(test.encoder.beginRenderPass).not.toHaveBeenCalled();
  });

  it('routes Motion Blur through one bounded line-integration pass', () => {
    const test = fixture();
    const layer = createAdjustmentLayer(
      createP0FilterStack('motion-blur', { angle: 90, distance: 20 },
        (part) => `motion-${part}`),
      'Motion Blur', 'motion-blur'
    );
    const source = { createView: vi.fn(() => ({})) } as unknown as GPUTexture;
    expect(test.renderer.encode(test.encoder, source, layer)).not.toBe(source);
    expect(test.textures).toHaveLength(1);
    expect(test.encoder.beginRenderPass).toHaveBeenCalledOnce();
    const values = test.writeBuffer.mock.calls[0]?.[2] as ArrayBuffer;
    expect(new Float32Array(values)[0]).toBeCloseTo(0, 5);
    expect(new Float32Array(values)[1]).toBeCloseTo(2, 5);
    expect(new Uint32Array(values)[2]).toBe(21);
  });

  it('bypasses zero-distance Motion Blur without allocating GPU resources', () => {
    const test = fixture();
    const layer = createAdjustmentLayer(
      createP0FilterStack('motion-blur', { angle: 0, distance: 0 },
        (part) => `motion-${part}`),
      'Motion Blur', 'motion-blur'
    );
    const source = {} as GPUTexture;
    expect(test.renderer.encode(test.encoder, source, layer)).toBe(source);
    expect(test.textures).toHaveLength(0);
  });

  it('routes small round Maximum through one exact disk pass', () => {
    const test = fixture();
    const layer = createAdjustmentLayer(
      createP0FilterStack('maximum', { radius: 3, shape: 'round' },
        (part) => `maximum-${part}`),
      'Maximum', 'maximum'
    );
    const source = { createView: vi.fn(() => ({})) } as unknown as GPUTexture;
    expect(test.renderer.encode(test.encoder, source, layer)).not.toBe(source);
    expect(test.textures).toHaveLength(2);
    expect(test.encoder.beginRenderPass).toHaveBeenCalledOnce();
    const payload = test.writeBuffer.mock.calls[0]?.[2] as ArrayBuffer;
    const view = new DataView(payload);
    expect(view.getInt32(16, true)).toBe(3);
    expect(view.getUint32(20, true)).toBe(1);
  });

  it('uses bounded separable passes for large square Maximum', () => {
    const test = fixture();
    const layer = createAdjustmentLayer(
      createP0FilterStack('maximum', { radius: 500, shape: 'square' },
        (part) => `maximum-${part}`),
      'Maximum', 'maximum'
    );
    test.renderer.encode(test.encoder,
      { createView: vi.fn(() => ({})) } as unknown as GPUTexture, layer);
    expect(test.encoder.beginRenderPass).toHaveBeenCalledTimes(14);
  });
});
