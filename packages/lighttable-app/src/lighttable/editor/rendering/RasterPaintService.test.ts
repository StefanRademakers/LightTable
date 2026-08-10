import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultGradientPaint } from '@lighttable/paint-core';
import type { LayerId } from '../document/documentTypes';
import { RasterPaintService } from './RasterPaintService';

const layerId = 'layer-1' as LayerId;

const texture = () => ({
  createView: vi.fn(() => ({})),
  destroy: vi.fn()
}) as unknown as GPUTexture;

const harness = (hasRaster = true, rasterSize = { width: 64, height: 32 }) => {
  const source = texture();
  const maskTarget = texture();
  const selection = texture();
  const createdTextures: GPUTexture[] = [];
  const createdMaskTextures: GPUTexture[] = [];
  const pipelineSet = {
    brush: { getBindGroupLayout: vi.fn(() => ({})) },
    blur: { getBindGroupLayout: vi.fn(() => ({})) },
    brushPreserveTransparency: { getBindGroupLayout: vi.fn(() => ({})) },
    erase: { getBindGroupLayout: vi.fn(() => ({})) },
    erasePreserveTransparency: { getBindGroupLayout: vi.fn(() => ({})) },
    maskBrush: { getBindGroupLayout: vi.fn(() => ({})) },
    maskErase: { getBindGroupLayout: vi.fn(() => ({})) },
    clone: { getBindGroupLayout: vi.fn(() => ({})) },
    clonePreserveTransparency: { getBindGroupLayout: vi.fn(() => ({})) },
    healing: { getBindGroupLayout: vi.fn(() => ({})) },
    healingPreserveTransparency: { getBindGroupLayout: vi.fn(() => ({})) },
    fillColor: { getBindGroupLayout: vi.fn(() => ({})) },
    fillGradient: { getBindGroupLayout: vi.fn(() => ({})) },
    invertColors: { getBindGroupLayout: vi.fn(() => ({})) },
    maskFillColor: { getBindGroupLayout: vi.fn(() => ({})) },
    maskFillGradient: { getBindGroupLayout: vi.fn(() => ({})) },
    maskInvertColors: { getBindGroupLayout: vi.fn(() => ({})) }
  };
  const brushPipelines = vi.fn(() => pipelineSet);
  const pipelines = vi.fn(() => pipelineSet);
  const ensureSelectionTargets = vi.fn();
  const createBuffer = vi.fn(() => ({ destroy: vi.fn() }));
  const writeBuffer = vi.fn();
  const copyTextureToTexture = vi.fn();
  const submit = vi.fn();
  const onSubmittedWorkDone = vi.fn(() => Promise.resolve());
  const invalidateLayer = vi.fn();
  const captureHistoryRegions = vi.fn();
  const captureAllHistory = vi.fn();
  const releaseSubmittedResources = vi.fn();
  const drawFullscreen = vi.fn();
  const service = new RasterPaintService({
    device: {
      createBuffer,
      createBindGroup: vi.fn(() => ({})),
      createCommandEncoder: vi.fn(() => ({
        copyTextureToTexture,
        beginRenderPass: () => ({
          setPipeline: vi.fn(), setBindGroup: vi.fn(), draw: vi.fn(), end: vi.fn()
        }),
        finish: () => 'commands'
      })),
      queue: {
        writeBuffer,
        submit,
        onSubmittedWorkDone
      }
    } as unknown as GPUDevice,
    sampler: {} as GPUSampler,
    layerResources: {
      raster: (id: LayerId) => hasRaster && id === layerId
        ? { texture: source, maskTexture: null, maskId: null, ...rasterSize }
        : null
    } as never,
    selectionTextures: { mask: selection } as never,
    dimensions: () => ({ width: 64, height: 32 }),
    brushPipelines: brushPipelines as never,
    pipelines: pipelines as never,
    ensureSelectionTargets,
    createTextureSized: () => {
      const result = texture();
      createdTextures.push(result);
      return result;
    },
    createMaskTexture: () => {
      const result = texture();
      createdMaskTextures.push(result);
      return result;
    },
    maskTextureFor: (id) => id === layerId ? maskTarget : null,
    invalidateLayer,
    captureHistoryRegions,
    captureAllHistory,
    releaseSubmittedResources,
    drawFullscreen
  });
  return {
    service,
    pipelineSet,
    brushPipelines,
    pipelines,
    ensureSelectionTargets,
    createBuffer,
    writeBuffer,
    createdTextures,
    createdMaskTextures,
    copyTextureToTexture,
    submit,
    onSubmittedWorkDone,
    invalidateLayer,
    captureHistoryRegions,
    captureAllHistory,
    releaseSubmittedResources,
    drawFullscreen
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RasterPaintService', () => {
  it('prepares lazy brush resources without touching pixels or history', () => {
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2, STORAGE: 4 });
    const test = harness();

    test.service.prepareBrushResources();
    test.service.prepareBrushResources();

    expect(test.brushPipelines).toHaveBeenCalledTimes(2);
    expect(test.pipelines).not.toHaveBeenCalled();
    expect(test.ensureSelectionTargets).toHaveBeenCalledTimes(2);
    expect(test.createBuffer).toHaveBeenCalledTimes(1);
    expect(test.captureHistoryRegions).not.toHaveBeenCalled();
    expect(test.captureAllHistory).not.toHaveBeenCalled();
    expect(test.submit).not.toHaveBeenCalled();
    expect(test.invalidateLayer).not.toHaveBeenCalled();
  });

  it('keeps an empty brush batch as an allocation-free exact no-op', () => {
    const test = harness();

    test.service.paintDabs(
      layerId,
      'pixels',
      [],
      [1, 0, 0],
      0.5,
      1,
      1
    );

    expect(test.brushPipelines).not.toHaveBeenCalled();
    expect(test.pipelines).not.toHaveBeenCalled();
    expect(test.ensureSelectionTargets).not.toHaveBeenCalled();
    expect(test.createBuffer).not.toHaveBeenCalled();
  });

  it('does not compile invert pipelines for an unavailable target', () => {
    const test = harness(false);

    expect(test.service.invertColors(layerId)).toBe(false);
    expect(test.pipelines).not.toHaveBeenCalled();
    expect(test.createdTextures).toHaveLength(0);
  });

  it('captures conservative local brush bounds before submitting dabs', () => {
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2, STORAGE: 4 });
    const test = harness();

    test.service.paintDabs(
      layerId,
      'pixels',
      [{ x: 30, y: 20, size: 12, pressure: 1, flowScale: 1 }],
      [1, 0, 0],
      0.5,
      1,
      1,
      false,
      { a: 1, b: 0, c: 0, d: 1, tx: 10, ty: 5 }
    );

    expect(test.captureHistoryRegions).toHaveBeenCalledWith(
      layerId,
      'pixels',
      [{ x: 12, y: 7, width: 16, height: 16 }]
    );
    expect(test.captureHistoryRegions.mock.invocationCallOrder[0])
      .toBeLessThan(test.submit.mock.invocationCallOrder[0]!);
    expect(test.brushPipelines).toHaveBeenCalledOnce();
    expect(test.pipelines).not.toHaveBeenCalled();
  });

  it('packs analytic Basic brush tip parameters into each instanced dab', () => {
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2, STORAGE: 4 });
    const test = harness();

    test.service.paintDabs(
      layerId,
      'pixels',
      [{ x: 30, y: 20, size: 12, pressure: 1, flowScale: 1 }],
      [1, 0, 0],
      0.5,
      1,
      1,
      false,
      { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      false,
      { roundness: 0.2, angleDegrees: 45, roughness: 0.18 }
    );

    expect(test.createBuffer).toHaveBeenCalledWith(expect.objectContaining({ size: 48 }));
    const dabValues = test.writeBuffer.mock.calls
      .map((call) => call[2])
      .find((value): value is Float32Array => value instanceof Float32Array && value.length === 12);
    expect(dabValues?.[8]).toBeCloseTo(0.2);
    expect(dabValues?.[9]).toBeCloseTo(Math.PI / 4);
    expect(dabValues?.[10]).toBeCloseTo(0.18);
  });

  it('normalizes flow when dense resampling splits one requested spacing interval', () => {
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2, STORAGE: 4 });
    const test = harness();

    test.service.paintDabs(
      layerId,
      'pixels',
      [{ x: 30, y: 20, size: 400, pressure: 1, flowScale: 0.25 }],
      [1, 0, 0],
      1,
      1,
      0.5
    );

    const dabValues = test.writeBuffer.mock.calls
      .map((call) => call[2])
      .find((value): value is Float32Array => value instanceof Float32Array && value.length === 12);
    expect(dabValues?.[7]).toBeCloseTo(1 - Math.pow(0.5, 0.25));
  });

  it('reuses and grows the ordered brush upload buffer without a fence per batch', async () => {
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2, STORAGE: 4 });
    const test = harness();
    const dab = { x: 30, y: 20, size: 12, pressure: 1, flowScale: 1 };

    test.service.paintDabs(layerId, 'pixels', [dab], [1, 0, 0], 1, 1, 1);
    test.service.paintDabs(layerId, 'pixels', [dab], [1, 0, 0], 1, 1, 1);

    // One lazy canvas uniform plus one reusable storage buffer.
    expect(test.createBuffer).toHaveBeenCalledTimes(2);
    expect(test.onSubmittedWorkDone).not.toHaveBeenCalled();

    test.service.paintDabs(layerId, 'pixels', [dab, dab], [1, 0, 0], 1, 1, 1);
    expect(test.createBuffer).toHaveBeenCalledTimes(3);
    expect(test.onSubmittedWorkDone).toHaveBeenCalledOnce();
    await Promise.resolve();
  });

  it('reuses one immutable Blur source snapshot and invalidates only the edited layer', () => {
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2, STORAGE: 4 });
    const test = harness();

    test.service.paintDabs(
      layerId,
      'pixels',
      [{ x: 30, y: 20, size: 80, pressure: 1, flowScale: 1 }],
      [0, 0, 0],
      0.25,
      0.35,
      0.5,
      false,
      { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      false,
      undefined,
      'blur'
    );
    test.service.paintDabs(
      layerId,
      'pixels',
      [{ x: 32, y: 20, size: 80, pressure: 1, flowScale: 1 }],
      [0, 0, 0], 0.25, 0.35, 0.5, false,
      { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }, false, undefined, 'blur'
    );

    expect(test.createdTextures).toHaveLength(1);
    expect(test.copyTextureToTexture).toHaveBeenCalledWith(
      expect.objectContaining({ texture: expect.anything(), origin: { x: 0, y: 0 } }),
      { texture: test.createdTextures[0], origin: { x: 0, y: 0 } },
      [64, 32]
    );
    expect(test.pipelineSet.blur.getBindGroupLayout).toHaveBeenCalledTimes(2);
    expect(test.invalidateLayer).toHaveBeenCalledWith(layerId);
    expect(test.releaseSubmittedResources).not.toHaveBeenCalled();
  });

  it('copies only the Blur Brush sample support on a large raster surface', () => {
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2, STORAGE: 4 });
    const test = harness(true, { width: 4096, height: 4096 });

    test.service.paintDabs(
      layerId, 'pixels',
      [{ x: 300, y: 200, size: 80, pressure: 1, flowScale: 1 }],
      [0, 0, 0], 0.25, 0.35, 0.5, false,
      { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }, false, undefined, 'blur'
    );

    expect(test.copyTextureToTexture).toHaveBeenCalledWith(
      { texture: expect.anything(), origin: { x: 254, y: 154 } },
      { texture: test.createdTextures[0], origin: { x: 254, y: 154 } },
      [92, 92]
    );
  });

  it('routes Clone and Healing through one immutable sampled texture per stroke', async () => {
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2, STORAGE: 4 });
    const test = harness();
    const sampledTexture = texture();
    const source = {
      documentId: 'document-1',
      anchorLayerId: layerId,
      point: { x: 50, y: 12 }
    };
    const clone = {
      operator: 'clone' as const,
      source,
      sampleMode: 'current-and-below' as const,
      sourceOffset: { x: 40, y: 2 },
      diffusion: 5
    };
    const healing = { ...clone, operator: 'healing' as const };
    const dab = { x: 10, y: 10, size: 12, pressure: 1, flowScale: 1 };

    test.service.beginSampledStroke(sampledTexture, 64, 32, clone);
    expect(test.createBuffer).toHaveBeenCalledWith(expect.objectContaining({ size: 32 }));
    expect(test.writeBuffer).toHaveBeenCalledWith(
      expect.anything(), 0,
      expect.objectContaining({ 0: 64, 1: 32, 2: 40, 3: 2, 4: 5 })
    );
    test.service.paintDabs(
      layerId, 'pixels', [dab], [0, 0, 0], 1, 1, 1, false,
      { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }, false, undefined, 'paint', clone
    );
    expect(test.pipelineSet.clone.getBindGroupLayout).toHaveBeenCalledOnce();
    expect(test.pipelineSet.healing.getBindGroupLayout).not.toHaveBeenCalled();

    test.service.beginSampledStroke(sampledTexture, 64, 32, healing);
    test.service.paintDabs(
      layerId, 'pixels', [dab], [0, 0, 0], 1, 1, 1, false,
      { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }, false, undefined, 'paint', healing
    );
    expect(test.pipelineSet.healing.getBindGroupLayout).toHaveBeenCalledOnce();
    test.service.endSampledStroke();
    await Promise.resolve();
    expect(test.onSubmittedWorkDone).toHaveBeenCalledTimes(2);
  });

  it('uses alpha-preserving paint and eraser pipelines for locked transparency', () => {
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2, STORAGE: 4 });
    const painted = harness();
    const erased = harness();

    painted.service.paintDabs(
      layerId, 'pixels', [{ x: 10, y: 10, size: 8, pressure: 1, flowScale: 1 }],
      [1, 0, 0], 1, 1, 1, false,
      { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }, true
    );
    erased.service.paintDabs(
      layerId, 'pixels', [{ x: 10, y: 10, size: 8, pressure: 1, flowScale: 1 }],
      [1, 0, 0], 1, 1, 1, true,
      { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }, true
    );

    expect(painted.pipelineSet.brushPreserveTransparency.getBindGroupLayout).toHaveBeenCalled();
    expect(erased.pipelineSet.erasePreserveTransparency.getBindGroupLayout).toHaveBeenCalled();
  });

  it('invalidates only the painted layer presentation after a normal batch', () => {
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2, STORAGE: 4 });
    const test = harness();

    test.service.paintDabs(
      layerId, 'pixels',
      [{ x: 10, y: 10, size: 8, pressure: 1, flowScale: 1 }],
      [1, 0, 0], 1, 1, 1
    );

    expect(test.invalidateLayer).toHaveBeenCalledOnce();
    expect(test.invalidateLayer).toHaveBeenCalledWith(layerId);
    expect(test.releaseSubmittedResources).not.toHaveBeenCalled();
  });

  it('routes mask fills through a single-channel result pipeline', () => {
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2 });
    const test = harness();

    expect(test.service.fillColor(layerId, 'mask', [0, 0, 0], false)).toBe(true);
    expect(test.createdTextures).toHaveLength(0);
    expect(test.createdMaskTextures).toHaveLength(1);
    expect(test.drawFullscreen).toHaveBeenCalledWith(
      expect.anything(),
      test.pipelineSet.maskFillColor,
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
  });

  it('encodes fill as one submitted edit and invalidates the raster cache', () => {
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2 });
    const test = harness();

    expect(test.service.fillColor(
      layerId,
      'pixels',
      [0.2, 0.4, 0.6],
      true
    )).toBe(true);

    expect(test.pipelines).toHaveBeenCalledOnce();
    expect(test.captureAllHistory).toHaveBeenCalledWith(layerId, 'pixels');
    expect(test.ensureSelectionTargets).toHaveBeenCalledOnce();
    expect(test.drawFullscreen).toHaveBeenCalledOnce();
    expect(test.copyTextureToTexture).toHaveBeenCalledWith(
      { texture: test.createdTextures[0] },
      expect.anything(),
      [64, 32]
    );
    expect(test.submit).toHaveBeenCalledOnce();
    expect(test.invalidateLayer).toHaveBeenCalledWith(layerId);
    expect(test.releaseSubmittedResources).toHaveBeenCalledOnce();
  });

  it('keeps fill work and copies bounded to a tight raster surface', () => {
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2 });
    const test = harness(true, { width: 12, height: 7 });

    expect(test.service.fillColor(layerId, 'pixels', [1, 0, 0], false)).toBe(true);
    expect(test.copyTextureToTexture).toHaveBeenCalledWith(
      { texture: test.createdTextures[0] },
      expect.anything(),
      [12, 7]
    );
  });

  it('encodes a gradient LUT and keeps the GPU copy bounded to the tight raster', () => {
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2, STORAGE: 4 });
    const test = harness(true, { width: 12, height: 7 });
    const paint = {
      ...createDefaultGradientPaint('pixel-gradient', 'document'),
      transform: { a: 100, b: 0, c: 0, d: 100, tx: 4, ty: 5 }
    };

    expect(test.service.fillGradient(
      layerId,
      'pixels',
      paint,
      0.75,
      'multiply',
      false
    )).toBe(true);

    expect(test.createBuffer).toHaveBeenCalledTimes(2);
    expect(test.drawFullscreen).toHaveBeenCalledOnce();
    expect(test.copyTextureToTexture).toHaveBeenCalledWith(
      { texture: test.createdTextures[0] },
      expect.anything(),
      [12, 7]
    );
    expect(test.invalidateLayer).toHaveBeenCalledWith(layerId);
  });
});
