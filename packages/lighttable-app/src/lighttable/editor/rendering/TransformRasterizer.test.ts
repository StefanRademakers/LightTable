import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LayerId, RasterLayer } from '../document/documentTypes';
import { createDefaultLayerStyleStack } from '../styles/layerStyleDefaults';
import { identityAffineMatrix } from './renderContract';
import { TransformRasterizer } from './TransformRasterizer';
import { TransformSessionStore } from './TransformSessionStore';

const layerId = 'layer-1' as LayerId;

const rasterLayer = (overrides: Partial<RasterLayer> = {}): RasterLayer => ({
  id: layerId,
  type: 'raster',
  name: 'Layer',
  visible: true,
  locks: {
    transparency: false,
    pixels: false,
    position: false,
    all: false
  },
  opacity: 1,
  fillOpacity: 1,
  blendMode: 'normal',
  clipping: false,
  styleStack: createDefaultLayerStyleStack(),
  transform: identityAffineMatrix(),
  revision: 0,
  geometryRevision: 0,
  createdAt: 0,
  modifiedAt: 0,
  adjustmentStack: null,
  pixelRevision: 0,
  width: 64,
  height: 32,
  offsetX: 0,
  offsetY: 0,
  pixelSource: { kind: 'runtime-raster', runtimeId: 'runtime-1' },
  dirtyBounds: null,
  mask: null,
  ...overrides
});

const gpuTexture = () => ({
  createView: vi.fn(() => ({})),
  destroy: vi.fn()
}) as unknown as GPUTexture;

const createHarness = () => {
  const copyTextureToTexture = vi.fn();
  const submit = vi.fn();
  const createTexture = vi.fn(() => gpuTexture());
  const pipelines = vi.fn();
  const sourceTexture = gpuTexture();
  const sessions = new TransformSessionStore();
  const rasterizer = new TransformRasterizer({
    device: {
      createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
      createCommandEncoder: vi.fn(() => ({
        copyTextureToTexture,
        finish: () => 'commands'
      })),
      queue: {
        submit,
        writeBuffer: vi.fn()
      }
    } as unknown as GPUDevice,
    sampler: {} as GPUSampler,
    layerResources: {
      raster: (id: LayerId) => id === layerId
        ? { texture: sourceTexture, maskTexture: null, maskId: null }
        : null
    } as never,
    selectionTextures: {
      active: false,
      mask: null,
      result: null
    } as never,
    sessions,
    dimensions: () => ({ width: 64, height: 32 }),
    pipelines: pipelines as never,
    ensureSelectionTargets: vi.fn(),
    createTexture,
    createSelectionTexture: vi.fn(() => gpuTexture()),
    invalidateLayer: vi.fn(),
    drawFullscreen: vi.fn()
  });
  return {
    rasterizer,
    sessions,
    pipelines,
    createTexture,
    copyTextureToTexture,
    submit
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TransformRasterizer', () => {
  it('keeps complete-layer transforms as geometry without compiling raster pipelines', () => {
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2 });
    const harness = createHarness();

    harness.rasterizer.begin(rasterLayer(), false);
    expect(harness.rasterizer.update({
      a: 1.2,
      b: 0,
      c: 0,
      d: 1.2,
      tx: 12,
      ty: -4
    })).toBe(true);

    expect(harness.sessions.current?.usesSelection).toBe(false);
    expect(harness.pipelines).not.toHaveBeenCalled();
    expect(harness.copyTextureToTexture).toHaveBeenCalledTimes(1);
    expect(harness.submit).toHaveBeenCalledTimes(1);
  });

  it('rejects hidden or position-locked layers before allocating GPU resources', () => {
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2 });
    const hiddenHarness = createHarness();
    expect(() => hiddenHarness.rasterizer.begin(
      rasterLayer({ visible: false }),
      false
    )).toThrow('Select a visible, unlocked raster layer before transforming.');
    expect(hiddenHarness.createTexture).not.toHaveBeenCalled();

    const lockedHarness = createHarness();
    expect(() => lockedHarness.rasterizer.begin(
      rasterLayer({
        locks: {
          transparency: false,
          pixels: false,
          position: true,
          all: false
        }
      }),
      false
    )).toThrow('Select a visible, unlocked raster layer before transforming.');
    expect(lockedHarness.createTexture).not.toHaveBeenCalled();
  });

  it('destroys all preview resources when a transform is cancelled', () => {
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2 });
    const harness = createHarness();
    harness.rasterizer.begin(rasterLayer(), false);
    const session = harness.sessions.current!;

    expect(harness.rasterizer.cancel()).toBe(true);
    expect(session.sourceTexture.destroy).toHaveBeenCalledOnce();
    expect(session.previewTexture.destroy).toHaveBeenCalledOnce();
    expect(session.settingsBuffer.destroy).toHaveBeenCalledOnce();
    expect(harness.sessions.current).toBeNull();
  });
});
