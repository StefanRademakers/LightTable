import { LayerRuntimeStore } from './LayerRuntimeStore';
import { SubmittedResourceRetainer } from './SubmittedResourceRetainer';
import { RenderTargetPair } from './RenderTargetPair';
import { SelectionTextureStore } from './SelectionTextureStore';
import { TransformSessionStore } from './TransformSessionStore';
import { PixelEditSessionStore } from './PixelEditSessionStore';
import { PatternAssetStore } from './PatternAssetStore';
import { GeometryPreviewStore } from './GeometryPreviewStore';
import { documentPipelinesFor } from './DocumentPipelineBundle';
import { LayerDocumentAssetService } from './LayerDocumentAssetService';
import { LayerTextureCodec } from './LayerTextureCodec';
import { SelectionRasterizer } from './SelectionRasterizer';
import { SelectionContentAnalyzer } from './SelectionContentAnalyzer';
import { SelectionClipboardService } from './SelectionClipboardService';
import { RasterDocumentOperations } from './RasterDocumentOperations';
import { LayerStyleRenderer } from './LayerStyleRenderer';
import { LayerCompositor } from './LayerCompositor';
import { TransformRasterizer } from './TransformRasterizer';
import { PixelEditHistoryService } from './PixelEditHistoryService';
import { RasterPaintService } from './RasterPaintService';
import { PatternAssetLoader } from './PatternAssetLoader';
import { LayerThumbnailService } from './LayerThumbnailService';
import { ImportedLayerInitializer } from './ImportedLayerInitializer';
import { DocumentTextureFactory } from './DocumentTextureFactory';
import { DocumentResourceState } from './DocumentResourceState';
import { DocumentImageResourceLifecycle } from './DocumentImageResourceLifecycle';
import { DocumentTextureMemoryEstimator } from './DocumentTextureMemoryEstimator';
import { ToolPipelineProvider } from './ToolPipelineProvider';
import { LayerRuntimeCoordinator } from './LayerRuntimeCoordinator';
import { RenderResourceCoordinator } from './RenderResourceCoordinator';
import { VectorLayerRenderer } from './VectorLayerRenderer';
import {
  DevelopmentTextFixtureRenderer,
  type DevelopmentTextFixtureSnapshot
} from '../../text/rendering/DevelopmentTextFixtureRenderer';
import { TextLayerRenderer } from '../../text/rendering/TextLayerRenderer';
import { TextLayerRenderCoordinator } from '../../text/rendering/TextLayerRenderCoordinator';
export type { TextFontRuntimePort } from '../../text/rendering/TextLayerRenderCoordinator';
import { walkLayerTree } from '../document/layerTree';
import type { TextRenderPresentationSnapshot } from '../../application/rendering/rendererTypes';
export type { TextRenderPresentationSnapshot } from '../../application/rendering/rendererTypes';

export interface LayerDocumentRendererRuntime {
  layerResources: LayerRuntimeStore;
  layerStyleRenderer: LayerStyleRenderer;
  vectorLayerRenderer: VectorLayerRenderer;
  compositor: LayerCompositor;
  selectionTextures: SelectionTextureStore;
  documentAssets: LayerDocumentAssetService;
  selectionRasterizer: SelectionRasterizer;
  selectionContentAnalyzer: SelectionContentAnalyzer;
  selectionClipboard: SelectionClipboardService;
  transformRasterizer: TransformRasterizer;
  pixelEditHistory: PixelEditHistoryService;
  rasterPaint: RasterPaintService;
  rasterDocumentOperations: RasterDocumentOperations;
  layerThumbnails: LayerThumbnailService;
  importedLayerInitializer: ImportedLayerInitializer;
  resources: DocumentResourceState;
  geometryPreviews: GeometryPreviewStore;
  imageResources: DocumentImageResourceLifecycle;
  textureMemory: DocumentTextureMemoryEstimator;
  layerRuntimeCoordinator: LayerRuntimeCoordinator;
  renderResources: RenderResourceCoordinator;
  developmentTextFixture: DevelopmentTextFixtureRenderer;
  textLayerRenderer: TextLayerRenderer;
  textLayerCoordinator: TextLayerRenderCoordinator;
}

/**
 * Assembles the document-scoped GPU service graph.
 *
 * This is the only place where concrete renderer services know about one
 * another. LayerDocumentRenderer remains a stable editor-facing facade while
 * feature services retain their narrow dependency ports.
 */
export const createLayerDocumentRendererRuntime = (
  device: GPUDevice,
  sampler: GPUSampler,
  onDevelopmentTextFixtureChanged: (snapshot: DevelopmentTextFixtureSnapshot) => void = () => undefined,
  onTextRenderPresentation: (snapshot: TextRenderPresentationSnapshot) => void = () => undefined
): LayerDocumentRendererRuntime => {
  const pipelines = documentPipelinesFor(device);
  const resources = new DocumentResourceState();
  const toolPipelines = new ToolPipelineProvider(device);
  const textures = new DocumentTextureFactory({
    device,
    dimensions: resources.dimensions
  });
  const textureCodec = new LayerTextureCodec(device, sampler, {
    decode: pipelines.decode,
    maskDecode: pipelines.maskDecode,
    exportLayer: pipelines.exportLayer
  });
  const layerResources = new LayerRuntimeStore({
    createRasterTexture: (label) => textures.createColor(label),
    createMaskTexture: (label) => textures.createMask(label)
  });
  const patternAssets = new PatternAssetStore();
  const submittedResources = new SubmittedResourceRetainer({
    onSubmittedWorkDone: () => device.queue.onSubmittedWorkDone()
  });
  const layerStyleRenderer = new LayerStyleRenderer({
    device,
    sampler,
    fullscreenModule: pipelines.fullscreenModule,
    shapePipeline: pipelines.styleShape,
    patternAssets,
    submittedResources,
    dimensions: resources.dimensions,
    createTexture: (label) => textures.createColor(label),
    drawFullscreen: (encoder, pipeline, bindGroup, target, clearValue) =>
      textures.drawFullscreen(encoder, pipeline, bindGroup, target, clearValue)
  });
  const vectorLayerRenderer = new VectorLayerRenderer(device);
  const developmentTextFixture = new DevelopmentTextFixtureRenderer(
    device,
    onDevelopmentTextFixtureChanged
  );
  const textLayerRenderer = new TextLayerRenderer({
    createTexture: (label, width, height) => textures.createColorSized(label, width, height),
    createView: (texture) => texture.createView(),
    retireTexture: (texture) => submittedResources.retainTexture(texture),
    maximumTextureDimension: device.limits.maxTextureDimension2D
  });
  const textLayerCoordinator = new TextLayerRenderCoordinator({
    device,
    renderer: textLayerRenderer,
    requestRender: () => onDevelopmentTextFixtureChanged(developmentTextFixture.snapshot),
    onChanged: onTextRenderPresentation
  });
  const renderResources = new RenderResourceCoordinator({
    layerStyles: layerStyleRenderer,
    submittedResources
  });
  const layerRuntimeCoordinator = new LayerRuntimeCoordinator({
    store: layerResources,
    invalidateLayer: (layerId) => renderResources.invalidateLayer(layerId)
  });
  const layerThumbnails = new LayerThumbnailService({
    dimensions: resources.dimensions,
    layerSource: (layerId) => {
      const text = textLayerRenderer.thumbnailSource(layerId);
      if (text) return text;
      const raster = layerResources.raster(layerId)?.texture;
      const { width, height } = resources.dimensions();
      return raster ? { texture: raster, width, height } : null;
    },
    maskTexture: (layerId) => layerResources.maskTexture(layerId),
    encode: (source, maskChannel, width, height) =>
      textureCodec.encode(source, maskChannel, width, height)
  });
  const importedLayerInitializer = new ImportedLayerInitializer({
    device,
    sampler,
    decodePipeline: pipelines.decode,
    rasterTexture: (layerId) => layerResources.raster(layerId)?.texture ?? null,
    drawFullscreen: (encoder, pipeline, bindGroup, target, clearValue) =>
      textures.drawFullscreen(encoder, pipeline, bindGroup, target, clearValue)
  });
  const patternAssetLoader = new PatternAssetLoader({
    device,
    sampler,
    decodePipeline: pipelines.decode,
    store: patternAssets,
    generation: resources.generation,
    invalidateStyledLayers: () => renderResources.invalidateAllStyles(),
    drawFullscreen: (encoder, pipeline, bindGroup, target, clearValue) =>
      textures.drawFullscreen(encoder, pipeline, bindGroup, target, clearValue)
  });
  const compositeTargets = new RenderTargetPair({
    createTexture: (label) => textures.createColor(label),
    firstLabel: 'LightTable layer composite A',
    secondLabel: 'LightTable layer composite B'
  });
  const transformSessions = new TransformSessionStore();
  const pixelEditSessions = new PixelEditSessionStore();
  const geometryPreviews = new GeometryPreviewStore();
  const selectionTextures = new SelectionTextureStore({
    createSelectionTexture: (label) => textures.createSelection(label),
    createClipboardTexture: (label) => textures.createColor(label),
    initializeTargets: (mask, result, shape) =>
      textures.initializeSelectionTargets(mask, result, shape)
  });
  const ensureSelectionTargets = () => selectionTextures.ensureTargets();
  const compositor = new LayerCompositor({
    device,
    sampler,
    compositePipeline: pipelines.composite,
    adjustmentMixPipeline: pipelines.adjustmentMix,
    layerResources,
    targets: compositeTargets,
    submittedResources,
    transformSessions,
    pixelEditSessions,
    geometryPreviews,
    layerStyles: layerStyleRenderer,
    vectors: vectorLayerRenderer,
    texts: textLayerRenderer,
    developmentTextFixture,
    dimensions: resources.dimensions,
    syncDocument: (document) => {
      layerRuntimeCoordinator.sync(document);
      textLayerRenderer.sync(
        walkLayerTree(document.layers)
          .map(({ node }) => node)
          .filter((node) => node.type === 'text')
      );
    },
    maskTextureFor: (layerId) => layerResources.maskTexture(layerId),
    createTexture: (label) => textures.createColor(label),
    clearTexture: (encoder, texture) => textures.clear(encoder, texture),
    drawFullscreen: (encoder, pipeline, bindGroup, target, clearValue) =>
      textures.drawFullscreen(encoder, pipeline, bindGroup, target, clearValue)
  });
  const transformRasterizer = new TransformRasterizer({
    device,
    sampler,
    layerResources,
    selectionTextures,
    sessions: transformSessions,
    dimensions: resources.dimensions,
    pipelines: toolPipelines.get,
    ensureSelectionTargets,
    createTexture: (label) => textures.createColor(label),
    createSelectionTexture: (label) => textures.createSelection(label),
    invalidateLayer: (layerId) => renderResources.invalidateLayer(layerId),
    drawFullscreen: (encoder, pipeline, bindGroup, target, clearValue) =>
      textures.drawFullscreen(encoder, pipeline, bindGroup, target, clearValue)
  });
  const pixelEditHistory = new PixelEditHistoryService({
    device,
    layerResources,
    sessions: pixelEditSessions,
    dimensions: resources.dimensions,
    createTexture: (label) => textures.createColor(label),
    maskTextureFor: (layerId) => layerResources.maskTexture(layerId),
    invalidateLayer: (layerId) => renderResources.invalidateLayer(layerId)
  });
  const rasterPaint = new RasterPaintService({
    device,
    layerResources,
    selectionTextures,
    dimensions: resources.dimensions,
    pipelines: toolPipelines.get,
    ensureSelectionTargets,
    createTexture: (label) => textures.createColor(label),
    maskTextureFor: (layerId) => layerResources.maskTexture(layerId),
    invalidateLayer: (layerId) => renderResources.invalidateLayer(layerId),
    releaseSubmittedResources: () => renderResources.releaseAfterSubmit(),
    drawFullscreen: (encoder, pipeline, bindGroup, target, clearValue) =>
      textures.drawFullscreen(encoder, pipeline, bindGroup, target, clearValue)
  });
  const selectionRasterizer = new SelectionRasterizer({
    device,
    sampler,
    textures: selectionTextures,
    dimensions: resources.dimensions,
    pipelines: toolPipelines.get,
    ensureTargets: ensureSelectionTargets,
    drawFullscreen: (encoder, pipeline, bindGroup, target, clearValue) =>
      textures.drawFullscreen(encoder, pipeline, bindGroup, target, clearValue),
    clearTexture: (encoder, texture, clearValue) =>
      textures.clear(encoder, texture, clearValue)
  });
  const selectionContentAnalyzer = new SelectionContentAnalyzer({
    device,
    textures: selectionTextures,
    dimensions: resources.dimensions,
    generation: resources.generation,
    pipelines: toolPipelines.get,
    ensureTargets: ensureSelectionTargets,
    rasterRuntime: (layerId) => layerResources.raster(layerId),
    createCoverageTexture: (label) => textures.createSelection(label),
    drawFullscreen: (encoder, pipeline, bindGroup, target, clearValue) =>
      textures.drawFullscreen(encoder, pipeline, bindGroup, target, clearValue)
  });
  const selectionClipboard = new SelectionClipboardService({
    device,
    textures: selectionTextures,
    layerResources,
    textureCodec,
    dimensions: resources.dimensions,
    generation: resources.generation,
    pipelines: toolPipelines.get,
    invalidateLayer: (layerId) => renderResources.invalidateLayer(layerId),
    drawFullscreen: (encoder, pipeline, bindGroup, target, clearValue) =>
      textures.drawFullscreen(encoder, pipeline, bindGroup, target, clearValue)
  });
  const encodeComposite = (
    encoder: GPUCommandEncoder,
    document: Parameters<LayerCompositor['encode']>[1],
    encodeAdjustment?: Parameters<LayerCompositor['encode']>[2]
  ) => compositor.encode(encoder, document, encodeAdjustment);
  const rasterDocumentOperations = new RasterDocumentOperations({
    device,
    layerResources,
    dimensions: resources.dimensions,
    encodeComposite,
    invalidateLayer: (layerId) => renderResources.invalidateLayer(layerId),
    releaseSubmittedResources: () => renderResources.releaseAfterSubmit(),
    textSourceReady: (layer) => textLayerCoordinator.isSettledForCurrentGeneration(layer)
  });
  const documentAssets = new LayerDocumentAssetService({
    rasterTexture: (layerId) => layerResources.raster(layerId)?.texture ?? null,
    maskTexture: (layerId) => layerResources.maskTexture(layerId),
    encodeTexture: (texture, maskChannel) => {
      const { width, height } = resources.dimensions();
      return textureCodec.encode(texture, maskChannel, width, height);
    },
    decodeTexture: async (blob, texture, maskChannel) => {
      const generation = resources.generation();
      const { width, height } = resources.dimensions();
      await textureCodec.decode(
        blob,
        texture,
        maskChannel,
        width,
        height,
        () => resources.isCurrent(generation)
      );
    },
    invalidateLayer: (layerId) => renderResources.invalidateLayer(layerId),
    patternSource: (patternId) => patternAssets.getSource(patternId),
    loadPattern: (asset) => patternAssetLoader.load(asset)
  });
  const imageResources = new DocumentImageResourceLifecycle({
    resourceState: resources,
    teardown: [
      () => layerResources.destroy(),
      () => patternAssets.clear(),
      () => layerStyleRenderer.destroy(),
      () => vectorLayerRenderer.destroy(),
      () => developmentTextFixture.dispose(),
      () => textLayerCoordinator.dispose(),
      () => compositeTargets.destroy(),
      () => selectionTextures.destroy(),
      () => geometryPreviews.clear(),
      () => transformRasterizer.cancel(),
      () => pixelEditSessions.destroy()
    ]
  });
  const textureMemory = new DocumentTextureMemoryEstimator({
    dimensions: resources.dimensions,
    sources: [
      ({ width, height }) =>
        layerResources.estimatedTextureBytes(width, height),
      () => patternAssets.estimatedTextureBytes(),
      ({ width, height }) =>
        layerStyleRenderer.estimatedTextureBytes(width, height),
      () => vectorLayerRenderer.estimatedTextureBytes(),
      () => textLayerCoordinator.estimatedTextureBytes(),
      ({ width, height }) =>
        compositeTargets.estimatedTextureBytes(width, height, 8),
      ({ width, height }) =>
        selectionTextures.estimatedTextureBytes(width, height),
      ({ rgba16Bytes }) =>
        pixelEditSessions.estimatedTextureBytes(rgba16Bytes),
      ({ rgba16Bytes, r8Bytes }) =>
        transformSessions.estimatedTextureBytes(rgba16Bytes, r8Bytes)
    ]
  });

  return {
    layerResources,
    layerStyleRenderer,
    vectorLayerRenderer,
    compositor,
    selectionTextures,
    documentAssets,
    selectionRasterizer,
    selectionContentAnalyzer,
    selectionClipboard,
    transformRasterizer,
    pixelEditHistory,
    rasterPaint,
    rasterDocumentOperations,
    layerThumbnails,
    importedLayerInitializer,
    resources,
    geometryPreviews,
    imageResources,
    textureMemory,
    layerRuntimeCoordinator,
    renderResources,
    developmentTextFixture,
    textLayerRenderer,
    textLayerCoordinator
  };
};
