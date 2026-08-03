import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COVERAGE_ATLAS_RASTERIZER_VERSION,
  type CoverageAtlasGlyphKey
} from '@lighttable/text-rendering';
import { CoverageAtlasBackend } from './CoverageAtlasBackend';

const key = (glyphId: number): CoverageAtlasGlyphKey => ({
  fontFingerprintSha256: 'b'.repeat(64), faceIndex: 0, glyphId,
  variationCoordinates: {}, syntheticBold: false, syntheticItalic: false,
  hinting: 'smooth', ppem: 24,
  renderMode: 'alpha', rasterizerVersion: COVERAGE_ATLAS_RASTERIZER_VERSION
});
const raster = (width = 8, height = 10) => ({
  width, height, bearingX: 1, bearingY: 8, pixels: new Uint8Array(width * height).fill(180)
});

const harness = () => {
  const texture = () => ({ createView: vi.fn(() => ({})), destroy: vi.fn() });
  const pass = {
    setPipeline: vi.fn(), setBindGroup: vi.fn(), draw: vi.fn(), end: vi.fn()
  };
  const pipeline = { getBindGroupLayout: vi.fn(() => ({})) };
  const device = {
    queue: {
      writeTexture: vi.fn(), writeBuffer: vi.fn(),
      onSubmittedWorkDone: vi.fn(async () => undefined)
    },
    createTexture: vi.fn(texture), createSampler: vi.fn(() => ({})),
    createShaderModule: vi.fn(() => ({})), createRenderPipeline: vi.fn(() => pipeline),
    createBuffer: vi.fn(() => ({ destroy: vi.fn() })), createBindGroup: vi.fn(() => ({}))
  } as unknown as GPUDevice;
  const encoder = { beginRenderPass: vi.fn(() => pass) } as unknown as GPUCommandEncoder;
  return { device, encoder, pass };
};

describe('production coverage atlas WebGPU backend', () => {
  beforeEach(() => {
    vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 1, COPY_DST: 2 });
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, STORAGE: 2, COPY_DST: 4 });
  });

  it('uploads each key once and batches premultiplied draws by page', async () => {
    const { device, encoder, pass } = harness();
    const backend = new CoverageAtlasBackend(device, 64, 2);
    const first = backend.prepareGlyph(key(1), raster());
    const hit = backend.prepareGlyph(key(1), raster());
    expect(hit.placement).toBe(first.placement);
    expect(device.queue.writeTexture).toHaveBeenCalledTimes(1);
    expect(backend.lookupGlyph(key(1))).toEqual(hit);
    expect(backend.encode(encoder, {
      view: {} as GPUTextureView, format: 'rgba16float', width: 128, height: 64, loadOp: 'clear'
    }, [{ glyph: first, x: 10, y: 20, color: [0.4, 0.2, 0.1, 0.5] }])).toBe(1);
    expect(pass.draw).toHaveBeenCalledWith(6, 1);
    await backend.retireSubmittedResources();
    expect(backend.metrics()).toMatchObject({ pages: 1, entries: 1, hits: 2, misses: 1, uploads: 1, drawBatches: 1 });
  });

  it('rejects stale page generations and defers evicted texture destruction', async () => {
    const { device, encoder } = harness();
    const backend = new CoverageAtlasBackend(device, 64, 1);
    const stale = backend.prepareGlyph(key(1), raster(60, 60));
    backend.prepareGlyph(key(2), raster(60, 60));
    const firstPage = vi.mocked(device.createTexture).mock.results[0].value;
    expect(firstPage.destroy).not.toHaveBeenCalled();
    expect(device.createTexture).toHaveBeenCalledTimes(2);
    expect(() => backend.encode(encoder, {
      view: {} as GPUTextureView, format: 'rgba16float', width: 64, height: 64
    }, [{ glyph: stale, x: 0, y: 0, color: [1, 1, 1, 1] }])).toThrow(/stale/);
    const current = backend.prepareGlyph(key(2), raster(60, 60));
    expect(() => backend.encode(encoder, {
      view: {} as GPUTextureView, format: 'rgba16float', width: 64, height: 64
    }, [{ glyph: current, x: 0, y: 0, color: [1, 0, 0, 0.5] }])).toThrow(/premultiplied/);
    await backend.retireSubmittedResources();
    expect(firstPage.destroy).toHaveBeenCalledOnce();
  });

  it('retains published glyph pages and releases them without underflow', () => {
    const { device } = harness();
    const backend = new CoverageAtlasBackend(device, 64, 1);
    const retained = backend.prepareGlyph(key(1), raster(60, 60));
    const release = backend.retainGlyphs([retained, retained]);
    expect(backend.metrics()).toMatchObject({ pinnedPages: 1 });
    expect(() => backend.prepareGlyph(key(2), raster(60, 60))).toThrow(/unpinned page/);

    release();
    release();
    expect(backend.metrics()).toMatchObject({ pinnedPages: 0 });
    expect(() => backend.prepareGlyph(key(2), raster(60, 60))).not.toThrow();
  });

  it('holds encoded pages through submission completion', async () => {
    const { device, encoder } = harness();
    let completeSubmission!: () => void;
    vi.mocked(device.queue.onSubmittedWorkDone).mockImplementationOnce(() => new Promise<undefined>((resolve) => {
      completeSubmission = () => resolve(undefined);
    }));
    const backend = new CoverageAtlasBackend(device, 64, 1);
    const glyph = backend.prepareGlyph(key(1), raster(60, 60));
    backend.encode(encoder, {
      view: {} as GPUTextureView, format: 'rgba16float', width: 64, height: 64
    }, [{ glyph, x: 0, y: 0, color: [1, 1, 1, 1] }]);
    expect(backend.metrics()).toMatchObject({ pinnedPages: 1 });
    expect(() => backend.prepareGlyph(key(2), raster(60, 60))).toThrow(/unpinned page/);

    const retiring = backend.retireSubmittedResources();
    expect(backend.metrics()).toMatchObject({ pinnedPages: 1 });
    completeSubmission();
    await retiring;
    expect(backend.metrics()).toMatchObject({ pinnedPages: 0 });
    expect(() => backend.prepareGlyph(key(2), raster(60, 60))).not.toThrow();
  });

  it('invalidates page resources and placements on device loss', () => {
    const { device } = harness();
    const backend = new CoverageAtlasBackend(device, 64, 1);
    const prepared = backend.prepareGlyph(key(1), raster());
    backend.invalidateForDeviceLoss();
    expect(backend.metrics()).toMatchObject({ pages: 0, entries: 0, atlasGeneration: 2 });
    expect(() => backend.encode({} as GPUCommandEncoder, {
      view: {} as GPUTextureView, format: 'rgba16float', width: 64, height: 64
    }, [{ glyph: prepared, x: 0, y: 0, color: [1, 1, 1, 1] }])).toThrow(/disposed/);
    const replacement = new CoverageAtlasBackend(device, 64, 1);
    expect(() => replacement.prepareGlyph(key(1), raster())).not.toThrow();
  });

  it('preserves painter order by splitting non-contiguous atlas pages', () => {
    const { device, encoder, pass } = harness();
    const backend = new CoverageAtlasBackend(device, 64, 2);
    const pageOne = backend.prepareGlyph(key(1), raster(60, 60));
    const pageTwo = backend.prepareGlyph(key(2), raster(60, 60));
    expect(backend.encode(encoder, {
      view: {} as GPUTextureView, format: 'rgba16float', width: 64, height: 64
    }, [pageOne, pageTwo, pageOne].map((glyph) => ({
      glyph, x: 0, y: 0, color: [1, 1, 1, 1] as const
    })))).toBe(3);
    expect(pass.draw).toHaveBeenCalledTimes(3);
  });

  it('does not cache a glyph when its GPU upload fails', () => {
    const { device } = harness();
    const backend = new CoverageAtlasBackend(device, 64, 1);
    vi.mocked(device.queue.writeTexture).mockImplementationOnce(() => {
      throw new Error('device rejected upload');
    });
    expect(() => backend.prepareGlyph(key(1), raster())).toThrow(/rejected upload/);
    expect(() => backend.prepareGlyph(key(1), raster())).not.toThrow();
    expect(device.queue.writeTexture).toHaveBeenCalledTimes(2);
  });

  it('retires transient buffers without leaking a device-loss rejection', async () => {
    const { device, encoder } = harness();
    const backend = new CoverageAtlasBackend(device, 64, 1);
    const glyph = backend.prepareGlyph(key(1), raster());
    backend.encode(encoder, {
      view: {} as GPUTextureView, format: 'rgba16float', width: 64, height: 64
    }, [{ glyph, x: 0, y: 0, color: [1, 1, 1, 1] }]);
    vi.mocked(device.queue.onSubmittedWorkDone).mockRejectedValueOnce(new Error('device lost'));
    await expect(backend.retireSubmittedResources()).resolves.toBeUndefined();
  });

  it('destroys a texture whose view cannot be created and permits retry', () => {
    const { device } = harness();
    const brokenTexture = {
      createView: vi.fn(() => { throw new Error('view failed'); }),
      destroy: vi.fn()
    };
    vi.mocked(device.createTexture).mockReturnValueOnce(brokenTexture as unknown as GPUTexture);
    const backend = new CoverageAtlasBackend(device, 64, 1);
    expect(() => backend.prepareGlyph(key(1), raster())).toThrow(/view failed/);
    expect(brokenTexture.destroy).toHaveBeenCalledOnce();
    expect(() => backend.prepareGlyph(key(1), raster())).not.toThrow();
  });

  it('rejects adversarial page alternation before allocating draw buffers', () => {
    const { device, encoder } = harness();
    const backend = new CoverageAtlasBackend(device, 64, 2);
    const first = backend.prepareGlyph(key(1), raster(60, 60));
    const second = backend.prepareGlyph(key(2), raster(60, 60));
    const draws = Array.from({ length: 65 }, (_, index) => ({
      glyph: index % 2 ? first : second,
      x: 0, y: 0, color: [1, 1, 1, 1] as const
    }));
    expect(() => backend.encode(encoder, {
      view: {} as GPUTextureView, format: 'rgba16float', width: 64, height: 64
    }, draws)).toThrow(/batch limit/);
    expect(device.createBuffer).not.toHaveBeenCalled();
  });
});
