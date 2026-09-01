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

const createHarness = (runtimeDimensions = { width: 64, height: 32 }) => {
  const copyTextureToTexture = vi.fn();
  const submit = vi.fn();
  const createTexture = vi.fn(() => gpuTexture());
  const pipelines = vi.fn(() => ({
    transform: { getBindGroupLayout: vi.fn(() => ({})) },
    selectionTransform: { getBindGroupLayout: vi.fn(() => ({})) }
  }));
  const sourceTexture = gpuTexture();
  const selectionTextures = {
    active: false,
    mask: null as GPUTexture | null,
    result: null as GPUTexture | null
  };
  const drawFullscreen = vi.fn();
  const runtime = {
    texture: sourceTexture,
    width: runtimeDimensions.width,
    height: runtimeDimensions.height,
    maskTexture: null,
    maskId: null
  };
  const sessions = new TransformSessionStore();
  const rasterizer = new TransformRasterizer({
    device: {
      createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
      createBindGroup: vi.fn(() => ({})),
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
      raster: (id: LayerId) => id === layerId ? runtime : null,
      exchangeRasterPixels: (id: LayerId, replacement: Pick<typeof runtime, 'texture' | 'width' | 'height'>) => {
        if (id !== layerId) throw new Error('unknown layer');
        const displaced = {
          texture: runtime.texture,
          width: runtime.width,
          height: runtime.height
        };
        runtime.texture = replacement.texture;
        runtime.width = replacement.width;
        runtime.height = replacement.height;
        return displaced;
      }
    } as never,
    selectionTextures: selectionTextures as never,
    sessions,
    dimensions: () => ({ width: 64, height: 32 }),
    pipelines: pipelines as never,
    ensureSelectionTargets: vi.fn(),
    createTexture,
    createSelectionTexture: vi.fn(() => gpuTexture()),
    clearTexture: vi.fn(),
    invalidateLayer: vi.fn(),
    drawFullscreen
  });
  return {
    rasterizer,
    sessions,
    pipelines,
    createTexture,
    copyTextureToTexture,
    submit,
    runtime,
    sourceTexture,
    selectionTextures,
    drawFullscreen
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
    expect(harness.copyTextureToTexture).not.toHaveBeenCalled();
    expect(harness.submit).not.toHaveBeenCalled();
    expect(harness.createTexture).not.toHaveBeenCalled();
  });

  it('starts an off-canvas tight runtime transform without a GPU snapshot', () => {
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2 });
    const harness = createHarness({ width: 23, height: 17 });
    const layer = rasterLayer({ width: 23, height: 17 });

    harness.rasterizer.begin(layer, false);

    expect(harness.sessions.current).toMatchObject({
      sourceTexture: null,
      previewTexture: null,
      usesSelection: false,
      previewMode: 'none'
    });
    expect(harness.copyTextureToTexture).not.toHaveBeenCalled();
  });

  it('allocates the raster snapshot lazily when a whole-layer projective preview starts', () => {
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2 });
    const harness = createHarness({ width: 23, height: 17 });
    harness.rasterizer.begin(rasterLayer({ width: 23, height: 17 }), false);

    expect(harness.rasterizer.updateProjective(
      [{ x: 0, y: 0 }, { x: 23, y: 0 }, { x: 23, y: 17 }, { x: 0, y: 17 }],
      [{ x: 1, y: 2 }, { x: 24, y: 1 }, { x: 22, y: 19 }, { x: 0, y: 17 }]
    )).toBe(true);

    expect(harness.createTexture).toHaveBeenCalledTimes(2);
    expect(harness.copyTextureToTexture).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      [23, 17]
    );
    expect(harness.submit).toHaveBeenCalledTimes(2);
    expect(harness.sessions.current?.previewMode).toBe('projective');
  });

  it('promotes a tight placed raster to the document surface and swaps exact undo geometry', () => {
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2 });
    const harness = createHarness({ width: 23, height: 17 });
    harness.rasterizer.begin(rasterLayer({ width: 23, height: 17 }), false);
    expect(harness.rasterizer.updateProjective(
      [{ x: 0, y: 0 }, { x: 23, y: 0 }, { x: 23, y: 17 }, { x: 0, y: 17 }],
      [{ x: 11, y: 4 }, { x: 42, y: 2 }, { x: 38, y: 28 }, { x: 8, y: 25 }]
    )).toBe(true);

    const edit = harness.rasterizer.commit();
    expect(edit).not.toBeNull();
    expect(harness.runtime).toMatchObject({ width: 64, height: 32 });
    expect(harness.runtime.texture).not.toBe(harness.sourceTexture);
    expect(harness.copyTextureToTexture).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ texture: harness.sourceTexture }),
      [64, 32]
    );

    expect(edit?.undo()).toBe(true);
    expect(harness.runtime).toMatchObject({
      width: 23,
      height: 17,
      texture: harness.sourceTexture
    });
    expect(edit?.redo()).toBe(true);
    expect(harness.runtime).toMatchObject({ width: 64, height: 32 });
  });

  it('materializes a placed raster before applying its document-space selection', () => {
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2 });
    const harness = createHarness({ width: 23, height: 17 });
    harness.selectionTextures.active = true;
    harness.selectionTextures.mask = gpuTexture();
    harness.selectionTextures.result = gpuTexture();

    harness.rasterizer.begin(
      rasterLayer({ width: 23, height: 17 }),
      true,
      false,
      { a: 1, b: 0, c: 0, d: 1, tx: 11, ty: 7 }
    );

    expect(harness.drawFullscreen).toHaveBeenCalledTimes(3);
    expect(harness.sessions.current).toMatchObject({
      usesSelection: true,
      bakeLayer: false,
      previewMode: 'selection',
      matrix: identityAffineMatrix()
    });
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
    expect(session.sourceTexture).toBeNull();
    expect(session.previewTexture).toBeNull();
    expect(session.settingsBuffer).toBeNull();
    expect(harness.sessions.current).toBeNull();
  });
});
