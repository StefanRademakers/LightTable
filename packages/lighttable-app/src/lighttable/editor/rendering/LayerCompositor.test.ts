import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultTextLayerData } from '@lighttable/text-core';
import { translationMatrix } from '../geometry/affine';
import {
  createGroupLayer,
  createImageDocument,
  createAdjustmentLayer,
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
    const targets = { ensure: vi.fn(), destroy: vi.fn() };
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
      vectors: { encode: vi.fn(), retainLayerIds: vi.fn() } as never,
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
    expect(targets.destroy).toHaveBeenCalledOnce();
    expect(layerStyles.releaseTargets).toHaveBeenCalledOnce();
    expect(layerStyles.releaseCache).toHaveBeenCalledOnce();
  });

  it('composites a tight placed raster projective preview at document dimensions', () => {
    const document = createImageDocument('Placed transform', 1280, 720, 'source');
    const layer = document.layers[0];
    if (layer.type !== 'raster') throw new Error('fixture raster missing');
    layer.width = 400;
    layer.height = 400;
    layer.transform = translationMatrix(440, 160);
    const source = texture();
    const preview = texture();
    const compositeA = texture();
    const compositeB = texture();
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
      layerResources: {
        raster: vi.fn(() => ({
          texture: source,
          width: 400,
          height: 400,
          maskTexture: null,
          maskId: null
        }))
      } as never,
      targets: { ensure: vi.fn(() => [compositeA, compositeB]) } as never,
      submittedResources: { retainBuffer: vi.fn(), retainTexture: vi.fn() } as never,
      transformSessions: {
        current: {
          layerId: layer.id,
          previewMode: 'projective',
          previewTexture: preview,
          matrix: translationMatrix(440, 160)
        }
      } as never,
      pixelEditSessions: { current: null } as never,
      geometryPreviews: { resolve: vi.fn(() => null) } as never,
      layerStyles: { releaseTargets: vi.fn(), releaseCache: vi.fn() } as never,
      vectors: { encode: vi.fn(), retainLayerIds: vi.fn() } as never,
      dimensions: () => ({ width: 1280, height: 720 }),
      syncDocument: vi.fn(),
      maskTextureFor: vi.fn(() => null),
      createTexture: vi.fn(texture),
      clearTexture: vi.fn(),
      drawFullscreen: vi.fn()
    });

    compositor.encode({} as GPUCommandEncoder, document);

    const settings = writeBuffer.mock.calls[0]?.[2] as Float32Array;
    expect(Array.from(settings.slice(12, 16))).toEqual([1280, 720, 1280, 720]);
  });

  it('uses one transparent target for a document without visible layers', () => {
    const document = createImageDocument('Empty', 64, 32, 'source');
    document.layers = [];
    document.activeLayerId = null;
    const transparentTarget = texture();
    const targets = {
      ensureSingle: vi.fn(() => transparentTarget),
      ensure: vi.fn()
    };
    const clearTexture = vi.fn();
    const compositor = new LayerCompositor({
      device: {} as GPUDevice,
      sampler: {} as GPUSampler,
      compositePipeline: {} as GPURenderPipeline,
      adjustmentMixPipeline: {} as GPURenderPipeline,
      layerResources: { raster: vi.fn(() => null) } as never,
      targets: targets as never,
      submittedResources: {} as never,
      transformSessions: { current: null } as never,
      pixelEditSessions: { current: null } as never,
      geometryPreviews: { resolve: vi.fn(() => null) } as never,
      layerStyles: { releaseTargets: vi.fn(), releaseCache: vi.fn() } as never,
      vectors: { encode: vi.fn(), retainLayerIds: vi.fn() } as never,
      dimensions: () => ({ width: 64, height: 32 }),
      syncDocument: vi.fn(),
      maskTextureFor: vi.fn(() => null),
      createTexture: vi.fn(),
      clearTexture,
      drawFullscreen: vi.fn()
    });

    expect(compositor.encode({} as GPUCommandEncoder, document)).toBe(transparentTarget);
    expect(targets.ensureSingle).toHaveBeenCalledOnce();
    expect(targets.ensure).not.toHaveBeenCalled();
    expect(clearTexture).toHaveBeenCalledWith(expect.anything(), transparentTarget);
  });

  it('retains hidden canonical vector resources while skipping their composite', () => {
    const document = createImageDocument('Hidden vector', 64, 32, 'source');
    const hidden = createVectorLayer([], 'Hidden artwork');
    hidden.visible = false;
    document.layers = [hidden];
    document.activeLayerId = hidden.id;
    const transparentTarget = texture();
    const retainLayerIds = vi.fn();
    const encodeVector = vi.fn();
    const compositor = new LayerCompositor({
      device: {} as GPUDevice,
      sampler: {} as GPUSampler,
      compositePipeline: {} as GPURenderPipeline,
      adjustmentMixPipeline: {} as GPURenderPipeline,
      layerResources: { raster: vi.fn(() => null) } as never,
      targets: { ensureSingle: vi.fn(() => transparentTarget) } as never,
      submittedResources: {} as never,
      transformSessions: { current: null } as never,
      pixelEditSessions: { current: null } as never,
      geometryPreviews: { resolve: vi.fn(() => null) } as never,
      layerStyles: { releaseTargets: vi.fn(), releaseCache: vi.fn() } as never,
      vectors: { encode: encodeVector, retainLayerIds } as never,
      dimensions: () => ({ width: 64, height: 32 }),
      syncDocument: vi.fn(),
      maskTextureFor: vi.fn(() => null),
      createTexture: vi.fn(),
      clearTexture: vi.fn(),
      drawFullscreen: vi.fn()
    });

    expect(compositor.encode({} as GPUCommandEncoder, document)).toBe(transparentTarget);
    expect(retainLayerIds).toHaveBeenCalledOnce();
    expect([...retainLayerIds.mock.calls[0][0]]).toEqual([hidden.id]);
    expect(encodeVector).not.toHaveBeenCalled();
  });

  it('feeds standalone adjustment nodes from bottom to top through separate GPU passes', () => {
    const document = createImageDocument('Ordered adjustments', 64, 32, 'source');
    const curves = createAdjustmentLayer({
      id: 'curves-stack', revision: 1,
      modules: [{ id: 'curves', type: 'lt.curves', enabled: true, revision: 1, settings: {} }]
    }, 'Curves');
    const grade = createAdjustmentLayer({
      id: 'grade-stack', revision: 1,
      modules: [{ id: 'light', type: 'lt.light', enabled: true, revision: 1, settings: {} }]
    }, 'Grade');
    document.layers.push(curves, grade);
    const compositeA = texture();
    const compositeB = texture();
    const rasterTexture = texture();
    const cachedBaseTexture = {
      createView: vi.fn(() => ({})),
      destroy: vi.fn()
    } as unknown as GPUTexture;
    const curvesTexture = texture();
    const gradeTexture = texture();
    const encodeAdjustment = vi.fn((_encoder, _source, layer) =>
      layer.name === 'Curves' ? curvesTexture : gradeTexture
    );
    const compositor = new LayerCompositor({
      device: {
        queue: { writeBuffer: vi.fn() },
        createBuffer: vi.fn(() => ({})),
        createBindGroup: vi.fn(() => ({}))
      } as unknown as GPUDevice,
      sampler: {} as GPUSampler,
      compositePipeline: { getBindGroupLayout: vi.fn(() => ({})) } as unknown as GPURenderPipeline,
      adjustmentMixPipeline: { getBindGroupLayout: vi.fn(() => ({})) } as unknown as GPURenderPipeline,
      layerResources: { raster: vi.fn(() => ({ texture: rasterTexture, maskTexture: null })) } as never,
      targets: { ensure: vi.fn(() => [compositeA, compositeB]) } as never,
      submittedResources: { retainBuffer: vi.fn(), retainTexture: vi.fn() } as never,
      transformSessions: { current: null } as never,
      pixelEditSessions: { current: null } as never,
      geometryPreviews: { resolve: vi.fn(() => null) } as never,
      layerStyles: { releaseTargets: vi.fn(), releaseCache: vi.fn() } as never,
      vectors: { encode: vi.fn(), retainLayerIds: vi.fn() } as never,
      dimensions: () => ({ width: 64, height: 32 }),
      syncDocument: vi.fn(),
      maskTextureFor: vi.fn(() => null),
      createTexture: vi.fn(() => cachedBaseTexture),
      clearTexture: vi.fn(),
      drawFullscreen: vi.fn()
    });

    const encoder = { copyTextureToTexture: vi.fn() } as unknown as GPUCommandEncoder;
    compositor.encode(encoder, document, encodeAdjustment);

    expect(encodeAdjustment).toHaveBeenCalledTimes(2);
    expect(encodeAdjustment.mock.calls.map((call) => call[2].name)).toEqual(['Curves', 'Grade']);
    expect(encodeAdjustment.mock.calls[0]?.[1]).toBe(cachedBaseTexture);
    expect(encodeAdjustment.mock.calls[1]?.[1]).toBe(compositeA);
    expect(compositor.topmostSuffixCacheTelemetry()).toMatchObject({ misses: 1, hits: 0 });

    encodeAdjustment.mockClear();
    document.layers = [document.layers[0]!, grade, curves];
    compositor.encode(encoder, document, encodeAdjustment);
    expect(encodeAdjustment.mock.calls.map((call) => call[2].name)).toEqual(['Grade', 'Curves']);
    expect(compositor.topmostSuffixCacheTelemetry()).toMatchObject({ misses: 1, hits: 1 });
  });

  it('reuses the lower composite while editing an active midstack processing layer', () => {
    const document = createImageDocument('Midstack adjustment', 64, 32, 'lower-source');
    const lower = document.layers[0]!;
    const grade = createAdjustmentLayer({
      id: 'grade-stack', revision: 1,
      modules: [{ id: 'light', type: 'lt.light', enabled: true, revision: 1, settings: {} }]
    }, 'Grade');
    const upperDocument = createImageDocument('Upper', 64, 32, 'upper-source');
    const upper = upperDocument.layers[0]!;
    document.layers = [lower, grade, upper];
    document.activeLayerId = grade.id;

    const compositeA = texture();
    const compositeB = texture();
    const lowerTexture = texture();
    const upperTexture = texture();
    const cachedBaseTexture = {
      createView: vi.fn(() => ({})),
      destroy: vi.fn()
    } as unknown as GPUTexture;
    const adjustedTexture = texture();
    const raster = vi.fn((layer) => ({
      texture: layer.id === lower.id ? lowerTexture : upperTexture,
      maskTexture: null
    }));
    const encodeAdjustment = vi.fn(() => adjustedTexture);
    const compositor = new LayerCompositor({
      device: {
        queue: { writeBuffer: vi.fn() },
        createBuffer: vi.fn(() => ({})),
        createBindGroup: vi.fn(() => ({}))
      } as unknown as GPUDevice,
      sampler: {} as GPUSampler,
      compositePipeline: { getBindGroupLayout: vi.fn(() => ({})) } as unknown as GPURenderPipeline,
      adjustmentMixPipeline: { getBindGroupLayout: vi.fn(() => ({})) } as unknown as GPURenderPipeline,
      layerResources: { raster } as never,
      targets: { ensure: vi.fn(() => [compositeA, compositeB]) } as never,
      submittedResources: { retainBuffer: vi.fn(), retainTexture: vi.fn() } as never,
      transformSessions: { current: null } as never,
      pixelEditSessions: { current: null } as never,
      geometryPreviews: { resolve: vi.fn(() => null) } as never,
      layerStyles: { releaseTargets: vi.fn(), releaseCache: vi.fn() } as never,
      vectors: { encode: vi.fn(), retainLayerIds: vi.fn() } as never,
      dimensions: () => ({ width: 64, height: 32 }),
      syncDocument: vi.fn(),
      maskTextureFor: vi.fn(() => null),
      createTexture: vi.fn(() => cachedBaseTexture),
      clearTexture: vi.fn(),
      drawFullscreen: vi.fn()
    });
    const encoder = { copyTextureToTexture: vi.fn() } as unknown as GPUCommandEncoder;

    compositor.encode(encoder, document, encodeAdjustment);
    compositor.encode(encoder, document, encodeAdjustment);

    expect(raster).toHaveBeenCalledTimes(3);
    expect(compositor.topmostSuffixCacheTelemetry()).toMatchObject({ misses: 1, hits: 1 });

    document.layers = [{ ...lower, opacity: 0.5 }, grade, upper];
    compositor.encode(encoder, document, encodeAdjustment);
    expect(raster).toHaveBeenCalledTimes(5);
    expect(compositor.topmostSuffixCacheTelemetry()).toMatchObject({ misses: 2, hits: 1 });
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
      vectors: { encode: encodeVector, retainLayerIds: vi.fn() } as never,
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

  it('routes supported islands to Vello while preserving per-layer fallback', () => {
    const document = createImageDocument('Hybrid vectors', 64, 32, 'source');
    const raster = document.layers[0];
    const eligible = createVectorLayer([], 'Eligible');
    const fallback = createVectorLayer([], 'Fallback');
    fallback.vectorClip = {
      id: 'inverted', name: 'Inverted', enabled: true, inverted: true,
      elements: [], revision: 0
    };
    document.layers = [eligible, raster, fallback];
    document.activeLayerId = fallback.id;
    const compositeA = texture(); const compositeB = texture();
    const islandTexture = texture(); const fallbackTexture = texture(); const rasterTexture = texture();
    const encodedIslands: { canonicalLayerIds: readonly string[] }[] = [];
    const encodedLayers: unknown[] = [];
    const encodeIsland = vi.fn((island: { canonicalLayerIds: readonly string[] }) => {
      encodedIslands.push(island); return islandTexture;
    });
    const encodeVector = vi.fn((_encoder: unknown, layer: unknown) => {
      encodedLayers.push(layer); return fallbackTexture;
    });
    const vectors = {
      canRenderIsland: vi.fn((island: { backendEligibility: { vello: boolean } }) => (
        island.backendEligibility.vello
      )),
      prepareIslandFrame: vi.fn(), encodeIsland,
      encode: encodeVector, retainLayerIds: vi.fn()
    };
    const compositor = new LayerCompositor({
      device: {
        queue: { writeBuffer: vi.fn() }, createBuffer: vi.fn(() => ({})),
        createBindGroup: vi.fn(() => ({}))
      } as unknown as GPUDevice,
      sampler: {} as GPUSampler,
      compositePipeline: { getBindGroupLayout: vi.fn(() => ({})) } as unknown as GPURenderPipeline,
      adjustmentMixPipeline: {} as GPURenderPipeline,
      layerResources: { raster: vi.fn(() => ({ texture: rasterTexture, maskTexture: null })) } as never,
      targets: { ensure: vi.fn(() => [compositeA, compositeB]) } as never,
      submittedResources: { retainBuffer: vi.fn(), retainTexture: vi.fn() } as never,
      transformSessions: { current: null } as never,
      pixelEditSessions: { current: null } as never,
      geometryPreviews: { resolve: vi.fn(() => null) } as never,
      layerStyles: { releaseTargets: vi.fn(), releaseCache: vi.fn() } as never,
      vectors: vectors as never,
      dimensions: () => ({ width: 64, height: 32 }), syncDocument: vi.fn(),
      maskTextureFor: vi.fn(() => null), createTexture: vi.fn(texture),
      clearTexture: vi.fn(), drawFullscreen: vi.fn()
    });

    compositor.resetCompositeTelemetry();
    compositor.encode({} as GPUCommandEncoder, document);

    expect(encodeIsland).toHaveBeenCalledOnce();
    expect(encodedIslands[0]?.canonicalLayerIds).toEqual([eligible.id]);
    expect(encodeVector).toHaveBeenCalledOnce();
    expect(encodedLayers[0]).toBe(fallback);
    expect(compositor.renderIslandTelemetry().plan?.islands.map(island => (
      island.selectedBackend
    ))).toEqual(['vello', 'current']);
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
      vectors: { encode: encodeVector, retainLayerIds: vi.fn() } as never,
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

    encodeVector.mockClear();
    encodeDevelopmentText.mockClear();
    compositor.encode(
      { export: true } as unknown as GPUCommandEncoder,
      document,
      undefined,
      false,
      new Set([textLayer.id])
    );
    expect(encodeVector).not.toHaveBeenCalled();
    expect(encodeDevelopmentText).not.toHaveBeenCalled();
  });

  it('composites an exact tight text source with a transient semantic transform preview', () => {
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
      geometryPreviews: { resolve: vi.fn(() => translationMatrix(13, 17)) } as never,
      layerStyles: { releaseTargets: vi.fn(), releaseCache: vi.fn() } as never,
      vectors: { encode: encodeVector, retainLayerIds: vi.fn() } as never,
      texts: { resolvePresentation: resolve } as never,
      dimensions: () => ({ width: 64, height: 32 }),
      syncDocument: vi.fn(),
      maskTextureFor: vi.fn(() => null),
      createTexture: vi.fn(texture),
      clearTexture: vi.fn(),
      drawFullscreen: vi.fn()
    });

    expect(compositor.encode({} as GPUCommandEncoder, document)).toBe(compositeB);
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        id: textLayer.id,
        transform: translationMatrix(13, 17)
      }),
      group.transform
    );
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
      vectors: { encode: encodeVector, retainLayerIds: vi.fn() } as never,
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
