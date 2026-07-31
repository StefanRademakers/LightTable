import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LayerId } from '../document/documentTypes';
import { RasterPaintService } from './RasterPaintService';

const layerId = 'layer-1' as LayerId;

const texture = () => ({
  createView: vi.fn(() => ({})),
  destroy: vi.fn()
}) as unknown as GPUTexture;

const harness = (hasRaster = true) => {
  const source = texture();
  const selection = texture();
  const createdTextures: GPUTexture[] = [];
  const pipelines = vi.fn(() => ({
    fillColor: { getBindGroupLayout: vi.fn(() => ({})) },
    invertColors: { getBindGroupLayout: vi.fn(() => ({})) }
  }));
  const ensureSelectionTargets = vi.fn();
  const createBuffer = vi.fn(() => ({ destroy: vi.fn() }));
  const copyTextureToTexture = vi.fn();
  const submit = vi.fn();
  const invalidateLayer = vi.fn();
  const releaseSubmittedResources = vi.fn();
  const drawFullscreen = vi.fn();
  const service = new RasterPaintService({
    device: {
      createBuffer,
      createBindGroup: vi.fn(() => ({})),
      createCommandEncoder: vi.fn(() => ({
        copyTextureToTexture,
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
        ? { texture: source, maskTexture: null, maskId: null }
        : null
    } as never,
    selectionTextures: { mask: selection } as never,
    dimensions: () => ({ width: 64, height: 32 }),
    pipelines: pipelines as never,
    ensureSelectionTargets,
    createTexture: () => {
      const result = texture();
      createdTextures.push(result);
      return result;
    },
    maskTextureFor: () => null,
    invalidateLayer,
    releaseSubmittedResources,
    drawFullscreen
  });
  return {
    service,
    pipelines,
    ensureSelectionTargets,
    createBuffer,
    createdTextures,
    copyTextureToTexture,
    submit,
    invalidateLayer,
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
});
