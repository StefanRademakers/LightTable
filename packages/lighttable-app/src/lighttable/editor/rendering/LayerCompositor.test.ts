import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultTextLayerData } from '@lighttable/text-core';
import { translationMatrix } from '../geometry/affine';
import {
  createGroupLayer,
  createImageDocument,
  createTextLayerNode,
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

  it('renders fixture text as a derived GPU vector placeholder without hiding raster layers', () => {
    const document = createImageDocument('Text fixture', 64, 32, 'source');
    const textLayer = createTextLayerNode(createDefaultTextLayerData(), 'Headline');
    document.layers.push(textLayer);
    document.activeLayerId = textLayer.id;
    const compositeA = texture();
    const compositeB = texture();
    const rasterTexture = texture();
    const placeholderTexture = texture();
    const encodeVector = vi.fn(() => placeholderTexture);
    const encodeDevelopmentText = vi.fn(() => 1);
    const raster = vi.fn(() => ({ texture: rasterTexture, maskTexture: null }));
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
      layerResources: { raster } as never,
      targets: { ensure: vi.fn(() => [compositeA, compositeB]) } as never,
      submittedResources: { retainBuffer: vi.fn(), retainTexture: vi.fn() } as never,
      transformSessions: { current: null } as never,
      pixelEditSessions: { current: null } as never,
      geometryPreviews: { resolve: vi.fn(() => null) } as never,
      layerStyles: { releaseTargets: vi.fn(), releaseCache: vi.fn() } as never,
      vectors: { encode: encodeVector } as never,
      developmentTextFixture: {
        hasReadyPlan: true,
        encode: encodeDevelopmentText
      } as never,
      dimensions: () => ({ width: 64, height: 32 }),
      syncDocument: vi.fn(),
      maskTextureFor: vi.fn(() => null),
      createTexture: vi.fn(texture),
      clearTexture: vi.fn(),
      drawFullscreen
    });

    expect(compositor.encode({} as GPUCommandEncoder, document)).toBe(compositeA);
    expect(raster).toHaveBeenCalledWith(document.layers[0].id);
    expect(encodeVector).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: textLayer.id, type: 'vector' }),
      textLayer.transform,
      { width: 64, height: 32 }
    );
    expect(drawFullscreen).toHaveBeenCalledTimes(2);
    expect(document.layers[1]).toBe(textLayer);
    expect(textLayer.type).toBe('text');

    expect(encodeDevelopmentText).not.toHaveBeenCalled();
    compositor.encode({ fixture: true } as unknown as GPUCommandEncoder, document, undefined, true);
    expect(encodeDevelopmentText).toHaveBeenCalledWith(
      { fixture: true },
      compositeA,
      { width: 64, height: 32 }
    );
  });

  it('composites an exact tight text source with inherited transform instead of the placeholder', () => {
    const document = createImageDocument('Text source', 64, 32, 'source');
    const textLayer = createTextLayerNode(createDefaultTextLayerData(), 'Headline');
    const group = createGroupLayer('Group');
    group.transform = translationMatrix(9, -3);
    group.children = [textLayer];
    document.layers = [group];
    const compositeA = texture();
    const compositeB = texture();
    const sourceTexture = texture();
    const encodeVector = vi.fn();
    const resolve = vi.fn(() => ({
      layerId: textLayer.id,
      texture: sourceTexture,
      dimensions: { width: 20, height: 10 },
      bounds: { x: -2, y: 4, width: 20, height: 10 },
      colorSpace: 'linear-srgb' as const,
      alphaMode: 'premultiplied' as const,
      sourceKey: 'ready',
      transform: translationMatrix(7, 11)
    }));
    const writeBuffer = vi.fn();
    const compositor = new LayerCompositor({
      device: {
        queue: { writeBuffer },
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
      layerStyles: { releaseTargets: vi.fn(), releaseCache: vi.fn() } as never,
      vectors: { encode: encodeVector } as never,
      texts: { resolvePresentation: resolve } as never,
      dimensions: () => ({ width: 64, height: 32 }),
      syncDocument: vi.fn(),
      maskTextureFor: vi.fn(() => null),
      createTexture: vi.fn(texture),
      clearTexture: vi.fn(),
      drawFullscreen: vi.fn()
    });

    expect(compositor.encode({} as GPUCommandEncoder, document)).toBe(compositeB);
    expect(resolve).toHaveBeenCalledWith(textLayer, group.transform);
    expect(encodeVector).not.toHaveBeenCalled();
    const values = vi.mocked(writeBuffer).mock.calls[0][2] as Float32Array;
    expect([...values.slice(12, 14)]).toEqual([20, 10]);
  });

  it('treats settled empty text as transparent instead of drawing a placeholder', () => {
    const document = createImageDocument('Empty text', 64, 32, 'source');
    const textLayer = createTextLayerNode(createDefaultTextLayerData(), 'Empty');
    document.layers = [textLayer];
    const compositeA = texture();
    const compositeB = texture();
    const encodeVector = vi.fn();
    const drawFullscreen = vi.fn();
    const compositor = new LayerCompositor({
      device: {} as GPUDevice,
      sampler: {} as GPUSampler,
      compositePipeline: {} as GPURenderPipeline,
      adjustmentMixPipeline: {} as GPURenderPipeline,
      layerResources: { raster: vi.fn(() => null) } as never,
      targets: { ensure: vi.fn(() => [compositeA, compositeB]) } as never,
      submittedResources: {} as never,
      transformSessions: { current: null } as never,
      pixelEditSessions: { current: null } as never,
      geometryPreviews: { resolve: vi.fn(() => null) } as never,
      layerStyles: { releaseTargets: vi.fn(), releaseCache: vi.fn() } as never,
      vectors: { encode: encodeVector } as never,
      texts: { isTransparent: vi.fn(() => true), resolvePresentation: vi.fn() } as never,
      dimensions: () => ({ width: 64, height: 32 }),
      syncDocument: vi.fn(),
      maskTextureFor: vi.fn(() => null),
      createTexture: vi.fn(texture),
      clearTexture: vi.fn(),
      drawFullscreen
    });

    expect(compositor.encode({} as GPUCommandEncoder, document)).toBe(compositeA);
    expect(encodeVector).not.toHaveBeenCalled();
    expect(drawFullscreen).not.toHaveBeenCalled();
  });
});
