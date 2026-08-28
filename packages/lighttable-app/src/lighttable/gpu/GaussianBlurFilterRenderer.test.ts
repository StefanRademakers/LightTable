import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createAdjustmentLayer } from '../editor/document/documentTypes';
import { createGaussianBlurStack } from '../processing/gaussianBlurFilter';
import { createP0FilterStack } from '../processing/p0Filter';
import { createFilterStack } from '../processing/filter';
import { P1_FILTER_DEFINITIONS, P2_FILTER_DEFINITIONS } from '@lighttable/filter-core';
import { GaussianBlurFilterRenderer } from './GaussianBlurFilterRenderer';

beforeAll(() => {
  vi.stubGlobal('GPUTextureUsage', { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2 });
  vi.stubGlobal('GPUBufferUsage', { UNIFORM: 4, COPY_DST: 8 });
});

const fixture = (resolveRasterTexture: (id: string) => GPUTexture | null = () => null) => {
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
  const renderer = new GaussianBlurFilterRenderer(device, resolveRasterTexture);
  renderer.configure(20, 10, {} as GPUSampler);
  return { renderer, device, encoder, textures, buffers, pass, writeBuffer };
};

describe('GaussianBlurFilterRenderer', () => {
  it.each([...P1_FILTER_DEFINITIONS, ...P2_FILTER_DEFINITIONS])(
    'routes $kind through an implemented shared filter core',
    (definition) => {
      const test = fixture();
      const layer = createAdjustmentLayer(
        createFilterStack(definition.kind, definition.defaults, (part) => `${definition.kind}-${part}`),
        definition.label,
        definition.kind
      );
      const source = { createView: vi.fn(() => ({})) } as unknown as GPUTexture;
      expect(test.renderer.encode(test.encoder, source, layer)).not.toBe(source);
      expect(test.encoder.beginRenderPass).toHaveBeenCalled();
      test.renderer.destroy();
    }
  );

  it('allocates lazily and encodes two separable full-frame passes', () => {
    const test = fixture();
    const layer = createAdjustmentLayer(
      createGaussianBlurStack(9, (kind) => kind), 'Gaussian Blur', 'gaussian-blur'
    );
    const source = { createView: vi.fn(() => ({})) } as unknown as GPUTexture;

    expect(test.renderer.estimatedTextureBytes()).toBe(0);
    expect(test.renderer.encode(test.encoder, source, layer)).not.toBe(source);
    expect(test.textures).toHaveLength(2);
    expect(test.renderer.estimatedTextureBytes()).toBe(20 * 10 * 8 * 2);
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
    expect(test.textures).toHaveLength(1);
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

  it('routes Minimum through the shared erosion mode', () => {
    const test = fixture();
    const layer = createAdjustmentLayer(
      createP0FilterStack('minimum', { radius: 2, shape: 'square' },
        (part) => `minimum-${part}`),
      'Minimum', 'minimum'
    );
    test.renderer.encode(test.encoder,
      { createView: vi.fn(() => ({})) } as unknown as GPUTexture, layer);
    const payload = test.writeBuffer.mock.calls[0]?.[2] as ArrayBuffer;
    expect(new DataView(payload).getUint32(12, true)).toBe(1);
    expect(test.encoder.beginRenderPass).toHaveBeenCalledTimes(4);
  });

  it.each([
    ['gaussian', 3], ['lens', 4]
  ] as const)('routes Smart Sharpen %s through adaptive BlurCore mode %i', (remove, outputMode) => {
    const test = fixture();
    const layer = createAdjustmentLayer(
      createP0FilterStack('smart-sharpen', {
        amount: 150, radius: 2, reduceNoise: 30, remove, angle: 0
      }, (part) => `smart-${part}`),
      'Smart Sharpen', 'smart-sharpen'
    );
    test.renderer.encode(test.encoder,
      { createView: vi.fn(() => ({})) } as unknown as GPUTexture, layer);
    const vertical = test.writeBuffer.mock.calls[1]?.[2] as ArrayBuffer;
    expect(new Uint32Array(vertical)[4]).toBe(outputMode);
    expect(new Float32Array(vertical)[5]).toBeCloseTo(1.5);
    expect(new Float32Array(vertical)[6]).toBeCloseTo(30);
  });

  it('uses the authored angle for Smart Sharpen motion removal', () => {
    const test = fixture();
    const layer = createAdjustmentLayer(
      createP0FilterStack('smart-sharpen', {
        amount: 120, radius: 4, reduceNoise: 20, remove: 'motion', angle: 90
      }, (part) => `smart-motion-${part}`),
      'Smart Sharpen', 'smart-sharpen'
    );
    test.renderer.encode(test.encoder,
      { createView: vi.fn(() => ({})) } as unknown as GPUTexture, layer);
    const payload = test.writeBuffer.mock.calls[0]?.[2] as ArrayBuffer;
    expect(new Uint32Array(payload)[3]).toBe(1);
    expect(new Float32Array(payload)[0]).toBeCloseTo(0, 5);
    expect(new Float32Array(payload)[1]).toBeCloseTo(0.4, 5);
    expect(new Float32Array(payload)[4]).toBeCloseTo(1.2);
  });

  it('routes Reduce Noise through four retained wavelet scales', () => {
    const test = fixture();
    const layer = createAdjustmentLayer(
      createP0FilterStack('reduce-noise', {
        strength: 7, preserveDetails: 55, reduceColorNoise: 60, sharpenDetails: 15
      }, (part) => `denoise-${part}`),
      'Reduce Noise', 'reduce-noise'
    );
    const source = { createView: vi.fn(() => ({})) } as unknown as GPUTexture;
    expect(test.renderer.encode(test.encoder, source, layer)).not.toBe(source);
    expect(test.textures).toHaveLength(3);
    expect(test.encoder.beginRenderPass).toHaveBeenCalledTimes(8);
    const settings = test.writeBuffer.mock.calls[0]?.[2] as Float32Array;
    expect(Array.from(settings)).toEqual([
      expect.closeTo(0.7), expect.closeTo(0.55), expect.closeTo(0.6), expect.closeTo(0.15)
    ]);
  });

  it('bypasses a neutral Reduce Noise node without allocating textures', () => {
    const test = fixture();
    const layer = createAdjustmentLayer(
      createP0FilterStack('reduce-noise', {
        strength: 0, preserveDetails: 60, reduceColorNoise: 0, sharpenDetails: 0
      }, (part) => `denoise-neutral-${part}`),
      'Reduce Noise', 'reduce-noise'
    );
    const source = {} as GPUTexture;
    expect(test.renderer.encode(test.encoder, source, layer)).toBe(source);
    expect(test.textures).toHaveLength(0);
  });

  it('routes Displace through one map-driven pass without copying its raster map', () => {
    const map = { createView: vi.fn(() => ({})) } as unknown as GPUTexture;
    const test = fixture((id) => id === 'map-layer' ? map : null);
    const layer = createAdjustmentLayer(
      createP0FilterStack('displace', {
        horizontalScale: 12, verticalScale: -8, mapAssetId: 'map-layer',
        edgeMode: 'wrap', interpolation: 'bicubic'
      }, (part) => `displace-${part}`),
      'Displace', 'displace'
    );
    const source = { createView: vi.fn(() => ({})) } as unknown as GPUTexture;
    expect(test.renderer.encode(test.encoder, source, layer)).not.toBe(source);
    expect(test.textures).toHaveLength(1);
    expect(test.encoder.beginRenderPass).toHaveBeenCalledOnce();
    expect(map.createView).toHaveBeenCalledOnce();
    const payload = test.writeBuffer.mock.calls[0]?.[2] as ArrayBuffer;
    expect(Array.from(new Float32Array(payload).slice(0, 2))).toEqual([12, -8]);
    expect(Array.from(new Uint32Array(payload).slice(2, 4))).toEqual([2, 1]);
  });

  it('bypasses Displace exactly when its canonical raster map is unavailable', () => {
    const test = fixture();
    const layer = createAdjustmentLayer(
      createP0FilterStack('displace', {
        horizontalScale: 12, verticalScale: 8, mapAssetId: 'missing-layer',
        edgeMode: 'clamp', interpolation: 'bilinear'
      }, (part) => `missing-displace-${part}`),
      'Displace', 'displace'
    );
    const source = {} as GPUTexture;
    expect(test.renderer.encode(test.encoder, source, layer)).toBe(source);
    expect(test.textures).toHaveLength(0);
  });

  it('routes Surface Blur through two bounded passes sharing the original guide', () => {
    const test = fixture();
    const layer = createAdjustmentLayer(
      createP0FilterStack('surface-blur', { radius: 40, threshold: 25 },
        (part) => `surface-${part}`),
      'Surface Blur', 'surface-blur'
    );
    const source = { createView: vi.fn(() => ({})) } as unknown as GPUTexture;
    expect(test.renderer.encode(test.encoder, source, layer)).not.toBe(source);
    expect(test.textures).toHaveLength(2);
    expect(test.encoder.beginRenderPass).toHaveBeenCalledTimes(2);
    expect(source.createView).toHaveBeenCalledTimes(3);
    const horizontal = test.writeBuffer.mock.calls[0]?.[2] as ArrayBuffer;
    expect(Array.from(new Float32Array(horizontal).slice(0, 4))).toEqual([
      1, 0, 40, expect.closeTo(25 / 255)
    ]);
    expect(new Uint32Array(horizontal)[4]).toBe(16);
  });

  it('keeps Median exact for small windows and bounded at radius 100', () => {
    const exact = fixture();
    const exactLayer = createAdjustmentLayer(
      createP0FilterStack('median', { radius: 2 }, (part) => `median-exact-${part}`),
      'Median', 'median'
    );
    exact.renderer.encode(exact.encoder,
      { createView: vi.fn(() => ({})) } as unknown as GPUTexture, exactLayer);
    expect(exact.encoder.beginRenderPass).toHaveBeenCalledOnce();
    expect(Array.from(new Int32Array(exact.writeBuffer.mock.calls[0]?.[2] as Int32Array).slice(0, 2)))
      .toEqual([2, 1]);

    const broad = fixture();
    const broadLayer = createAdjustmentLayer(
      createP0FilterStack('median', { radius: 100 }, (part) => `median-broad-${part}`),
      'Median', 'median'
    );
    broad.renderer.encode(broad.encoder,
      { createView: vi.fn(() => ({})) } as unknown as GPUTexture, broadLayer);
    expect(broad.encoder.beginRenderPass).toHaveBeenCalledTimes(8);
    expect(broad.textures).toHaveLength(2);
  });

  it('shares at most three alias-safe targets across different filter cores', () => {
    const test = fixture();
    const source = { createView: vi.fn(() => ({})) } as unknown as GPUTexture;
    const gaussian = createAdjustmentLayer(
      createP0FilterStack('gaussian-blur', { radius: 8 }, (part) => `shared-gaussian-${part}`),
      'Gaussian Blur', 'gaussian-blur'
    );
    const surface = createAdjustmentLayer(
      createP0FilterStack('surface-blur', { radius: 12, threshold: 20 },
        (part) => `shared-surface-${part}`),
      'Surface Blur', 'surface-blur'
    );
    const denoise = createAdjustmentLayer(
      createP0FilterStack('reduce-noise', {
        strength: 6, preserveDetails: 50, reduceColorNoise: 40, sharpenDetails: 10
      }, (part) => `shared-denoise-${part}`),
      'Reduce Noise', 'reduce-noise'
    );
    const first = test.renderer.encode(test.encoder, source, gaussian);
    const second = test.renderer.encode(test.encoder, first, surface);
    test.renderer.encode(test.encoder, second, denoise);
    expect(test.textures).toHaveLength(3);
    expect(test.renderer.estimatedTextureBytes()).toBe(20 * 10 * 8 * 3);
  });
});
