import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAdjustmentLayer,
  type LayerId,
  type RasterLayer
} from '../document/documentTypes';
import { createDefaultAdjustments } from '../../types';
import { createAdjustmentStackFromBasicAdjustments } from '../../processing/adjustmentStack';
import { createDefaultLayerStyleStack } from '../styles/layerStyleDefaults';
import { identityAffineMatrix } from './renderContract';
import { SelectionContentAnalyzer } from './SelectionContentAnalyzer';

const layer = (): RasterLayer => ({
  id: 'tight-raster' as LayerId,
  type: 'raster',
  name: 'Tight raster',
  visible: true,
  locks: { transparency: false, pixels: false, position: false, all: false },
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
  width: 4,
  height: 3,
  offsetX: 0,
  offsetY: 0,
  pixelSource: { kind: 'runtime-raster', runtimeId: 'tight-runtime' },
  dirtyBounds: null,
  mask: null
});

afterEach(() => vi.unstubAllGlobals());

describe('SelectionContentAnalyzer', () => {
  it('measures a non-raster layer mask through the shared mask resource', async () => {
    vi.stubGlobal('GPUBufferUsage', { COPY_DST: 1, MAP_READ: 2 });
    vi.stubGlobal('GPUMapMode', { READ: 1 });
    const bytesPerRow = 256;
    const coverage = new Uint8Array(bytesPerRow * 3);
    coverage[bytesPerRow + 2] = 255;
    const source = {} as GPUTexture;
    const copyTextureToBuffer = vi.fn();
    const rasterRuntime = vi.fn();
    const maskTexture = vi.fn(() => source);
    const adjustment = createAdjustmentLayer(
      createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments()),
      'Grade',
      'grade'
    );
    const analyzer = new SelectionContentAnalyzer({
      device: {
        createBuffer: vi.fn(() => ({
          mapState: 'unmapped',
          mapAsync: vi.fn(async () => undefined),
          getMappedRange: vi.fn(() => coverage.buffer),
          unmap: vi.fn(),
          destroy: vi.fn()
        })),
        createCommandEncoder: vi.fn(() => ({
          copyTextureToBuffer,
          finish: vi.fn(() => ({}))
        })),
        queue: { submit: vi.fn() }
      } as unknown as GPUDevice,
      textures: {} as never,
      dimensions: () => ({ width: 4, height: 3 }),
      generation: () => 1,
      pipelines: vi.fn() as never,
      ensureTargets: vi.fn(),
      rasterRuntime,
      maskTexture,
      createCoverageTexture: vi.fn(),
      drawFullscreen: vi.fn()
    });

    await expect(analyzer.measureMask(adjustment)).resolves.toMatchObject({
      coreBounds: { x: 2, y: 1, width: 1, height: 1 }
    });
    expect(maskTexture).toHaveBeenCalledWith(adjustment.id);
    expect(rasterRuntime).not.toHaveBeenCalled();
    expect(copyTextureToBuffer).toHaveBeenCalledWith(
      { texture: source },
      expect.objectContaining({ bytesPerRow }),
      [4, 3]
    );
  });

  it('measures the canonical selection mask independently of layer content', async () => {
    vi.stubGlobal('GPUBufferUsage', { COPY_DST: 1, MAP_READ: 2 });
    vi.stubGlobal('GPUMapMode', { READ: 1 });
    const bytesPerRow = 256;
    const coverage = new Uint8Array(bytesPerRow * 3);
    coverage[bytesPerRow + 1] = 255;
    coverage[bytesPerRow + 2] = 64;
    const copyTextureToBuffer = vi.fn();
    const analyzer = new SelectionContentAnalyzer({
      device: {
        createBuffer: vi.fn(() => ({
          mapState: 'unmapped',
          mapAsync: vi.fn(async () => undefined),
          getMappedRange: vi.fn(() => coverage.buffer),
          unmap: vi.fn(),
          destroy: vi.fn()
        })),
        createCommandEncoder: vi.fn(() => ({
          copyTextureToBuffer,
          finish: vi.fn(() => ({}))
        })),
        queue: { submit: vi.fn() }
      } as unknown as GPUDevice,
      textures: { active: true, mask: {} } as never,
      dimensions: () => ({ width: 4, height: 3 }),
      generation: () => 1,
      pipelines: vi.fn() as never,
      ensureTargets: vi.fn(),
      rasterRuntime: vi.fn(),
      maskTexture: vi.fn(),
      createCoverageTexture: vi.fn(),
      drawFullscreen: vi.fn()
    });

    await expect(analyzer.measureSelection()).resolves.toEqual({
      coreBounds: { x: 1, y: 1, width: 1, height: 1 },
      supportBounds: { x: 1, y: 1, width: 2, height: 1 },
      peakCoverage: 1
    });
    expect(copyTextureToBuffer).toHaveBeenCalledOnce();
  });

  it('measures tight layer-local coverage instead of expanding to the document surface', async () => {
    vi.stubGlobal('GPUBufferUsage', { COPY_DST: 1, MAP_READ: 2, UNIFORM: 4 });
    vi.stubGlobal('GPUMapMode', { READ: 1 });
    const bytesPerRow = 256;
    const coverage = new Uint8Array(bytesPerRow * 3);
    coverage[bytesPerRow + 1] = 255;
    coverage[bytesPerRow + 2] = 255;
    const createCoverageTexture = vi.fn(() => ({
      createView: vi.fn(() => ({})), destroy: vi.fn()
    }) as unknown as GPUTexture);
    let bufferCount = 0;
    const analyzer = new SelectionContentAnalyzer({
      device: {
        createBuffer: vi.fn(() => {
          bufferCount += 1;
          return bufferCount === 1 ? {
            mapState: 'unmapped',
            mapAsync: vi.fn(async () => undefined),
            getMappedRange: vi.fn(() => coverage.buffer),
            unmap: vi.fn(),
            destroy: vi.fn()
          } : { destroy: vi.fn() };
        }),
        createBindGroup: vi.fn(() => ({})),
        createCommandEncoder: vi.fn(() => ({
          copyTextureToBuffer: vi.fn(),
          finish: vi.fn(() => ({}))
        })),
        queue: { writeBuffer: vi.fn(), submit: vi.fn() }
      } as unknown as GPUDevice,
      textures: {
        active: false,
        mask: { createView: vi.fn(() => ({})) }
      } as never,
      dimensions: () => ({ width: 266, height: 326 }),
      generation: () => 1,
      pipelines: () => ({
        selectionContentCoverage: { getBindGroupLayout: vi.fn(() => ({})) }
      }) as never,
      ensureTargets: vi.fn(),
      rasterRuntime: () => ({
        texture: { createView: vi.fn(() => ({})) } as unknown as GPUTexture,
        width: 4,
        height: 3,
        maskTexture: null,
        maskId: null
      }),
      maskTexture: vi.fn(),
      createCoverageTexture,
      drawFullscreen: vi.fn()
    });

    await expect(analyzer.measure(layer(), false)).resolves.toMatchObject({
      coreBounds: { x: 1, y: 1, width: 2, height: 1 },
      supportBounds: { x: 1, y: 1, width: 2, height: 1 }
    });
    expect(createCoverageTexture).toHaveBeenCalledWith(
      'LightTable layer content coverage', 4, 3
    );
  });
});
