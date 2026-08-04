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
    erase: { getBindGroupLayout: vi.fn(() => ({})) },
    maskBrush: { getBindGroupLayout: vi.fn(() => ({})) },
    maskErase: { getBindGroupLayout: vi.fn(() => ({})) },
    fillColor: { getBindGroupLayout: vi.fn(() => ({})) },
    fillGradient: { getBindGroupLayout: vi.fn(() => ({})) },
    invertColors: { getBindGroupLayout: vi.fn(() => ({})) },
    maskFillColor: { getBindGroupLayout: vi.fn(() => ({})) },
    maskFillGradient: { getBindGroupLayout: vi.fn(() => ({})) },
    maskInvertColors: { getBindGroupLayout: vi.fn(() => ({})) }
  };
  const pipelines = vi.fn(() => pipelineSet);
  const ensureSelectionTargets = vi.fn();
  const createBuffer = vi.fn(() => ({ destroy: vi.fn() }));
  const copyTextureToTexture = vi.fn();
  const submit = vi.fn();
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
        writeBuffer: vi.fn(),
        submit,
        onSubmittedWorkDone: () => Promise.resolve()
      }
    } as unknown as GPUDevice,
    layerResources: {
      raster: (id: LayerId) => hasRaster && id === layerId
        ? { texture: source, maskTexture: null, maskId: null, ...rasterSize }
        : null
    } as never,
    selectionTextures: { mask: selection } as never,
    dimensions: () => ({ width: 64, height: 32 }),
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
    pipelines,
    ensureSelectionTargets,
    createBuffer,
    createdTextures,
    createdMaskTextures,
    copyTextureToTexture,
    submit,
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
      [{ x: 30, y: 20, size: 12, pressure: 1 }],
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
