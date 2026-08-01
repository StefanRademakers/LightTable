import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translationMatrix } from '../geometry/affine';
import {
  createGroupLayer,
  createImageDocument,
  createVectorLayer
} from '../document/documentTypes';
import { LayerCompositor } from './LayerCompositor';

beforeEach(() => {
  vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2 });
});

const texture = () => ({ createView: vi.fn(() => ({})) }) as unknown as GPUTexture;

describe('LayerCompositor', () => {
  it('returns the source texture for a neutral one-layer document', () => {
    const document = createImageDocument('Image', 64, 32, 'source');
    const source = {} as GPUTexture;
    const syncDocument = vi.fn();
    const targets = { ensure: vi.fn() };
    const layerStyles = {
      releaseTargets: vi.fn(),
      releaseCache: vi.fn()
    };
    const compositor = new LayerCompositor({
      device: {} as GPUDevice,
      sampler: {} as GPUSampler,
      compositePipeline: {} as GPURenderPipeline,
      adjustmentMixPipeline: {} as GPURenderPipeline,
      layerResources: {
        raster: vi.fn(() => ({
          texture: source,
          maskTexture: null
        }))
      } as never,
      targets: targets as never,
      submittedResources: {} as never,
      transformSessions: { current: null } as never,
      pixelEditSessions: { current: null } as never,
      geometryPreviews: { resolve: vi.fn(() => null) } as never,
      layerStyles: layerStyles as never,
      vectors: { encode: vi.fn() } as never,
      dimensions: () => ({ width: 64, height: 32 }),
      syncDocument,
      maskTextureFor: vi.fn(() => null),
      createTexture: vi.fn(),
      clearTexture: vi.fn(),
      drawFullscreen: vi.fn()
    });

    expect(compositor.encode({} as GPUCommandEncoder, document)).toBe(source);
    expect(syncDocument).toHaveBeenCalledWith(document);
    expect(targets.ensure).not.toHaveBeenCalled();
    expect(layerStyles.releaseTargets).toHaveBeenCalledOnce();
    expect(layerStyles.releaseCache).toHaveBeenCalledOnce();
  });

  it('propagates parent transforms to native vector layers', () => {
    const document = createImageDocument('Vector group', 64, 32, 'source');
    const vector = createVectorLayer([], 'Shape');
    const group = createGroupLayer('Moved group');
    group.transform = translationMatrix(14, -6);
    group.children = [vector];
    document.layers = [group];
    document.activeLayerId = vector.id;
    const compositeA = texture();
    const compositeB = texture();
    const vectorTexture = texture();
    const encodeVector = vi.fn(() => vectorTexture);
    const drawFullscreen = vi.fn();
    const compositor = new LayerCompositor({
      device: {
        queue: { writeBuffer: vi.fn() },
        createBuffer: vi.fn(() => ({})),
        createBindGroup: vi.fn(() => ({}))
      } as unknown as GPUDevice,
      sampler: {} as GPUSampler,
      compositePipeline: { getBindGroupLayout: vi.fn(() => ({})) } as unknown as GPURenderPipeline,
      adjustmentMixPipeline: {} as GPURenderPipeline,
      layerResources: { raster: vi.fn(() => null) } as never,
      targets: { ensure: vi.fn(() => [compositeA, compositeB]) } as never,
      submittedResources: { retainBuffer: vi.fn(), retainTexture: vi.fn() } as never,
      transformSessions: { current: null } as never,
      pixelEditSessions: { current: null } as never,
      geometryPreviews: { resolve: vi.fn(() => null) } as never,
      layerStyles: {
        releaseTargets: vi.fn(),
        releaseCache: vi.fn()
      } as never,
      vectors: { encode: encodeVector } as never,
      dimensions: () => ({ width: 64, height: 32 }),
      syncDocument: vi.fn(),
      maskTextureFor: vi.fn(() => null),
      createTexture: vi.fn(texture),
      clearTexture: vi.fn(),
      drawFullscreen
    });

    expect(compositor.encode({} as GPUCommandEncoder, document)).toBe(compositeB);
    expect(encodeVector).toHaveBeenCalledWith(
      expect.anything(),
      vector,
      group.transform,
      { width: 64, height: 32 }
    );
    expect(drawFullscreen).toHaveBeenCalledOnce();
  });
});
