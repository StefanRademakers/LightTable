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
import { layerDerivedPreviewIsCurrent } from '../document/documentTypes';
import { RasterPaintService } from './RasterPaintService';
export type RasterGradientPaint = Parameters<RasterPaintService['fillGradient']>[2];
export type RasterGradientBlendMode = Parameters<RasterPaintService['fillGradient']>[4];
import { PatternAssetLoader } from './PatternAssetLoader';
import { LayerThumbnailService } from './LayerThumbnailService';
import { ImportedLayerInitializer } from './ImportedLayerInitializer';
import { DocumentTextureFactory } from './DocumentTextureFactory';
import { DocumentResourceState } from './DocumentResourceState';
import { DocumentImageResourceLifecycle } from './DocumentImageResourceLifecycle';
import { DocumentTextureMemoryEstimator } from './DocumentTextureMemoryEstimator';
import { ToolPipelineProvider } from './ToolPipelineProvider';
import { LayerRuntimeCoordinator } from './LayerRuntimeCoordinator';
import { identityAffineMatrix } from './renderContract';
import { RenderResourceCoordinator } from './RenderResourceCoordinator';
import { VectorLayerRenderer } from './VectorLayerRenderer';
import {
  DevelopmentTextFixtureRenderer,
  type DevelopmentTextFixtureSnapshot
} from '../../text/rendering/DevelopmentTextFixtureRenderer';
import { TextLayerRenderer } from '../../text/rendering/TextLayerRenderer';
import { TextLayerRenderCoordinator } from '../../text/rendering/TextLayerRenderCoordinator';
import { ImageResizeGpuService } from './ImageResizeGpuService';
import { DocumentGeometryGpuService } from './DocumentGeometryGpuService';
import { LayerPresentationPicker } from './LayerPresentationPicker';
import type { DocumentLayerResourceRepository } from './DocumentLayerResourceRepository';
import type { DocumentPatternResourceRepository } from './DocumentPatternResourceRepository';
export type { TextFontRuntimePort } from '../../text/rendering/TextLayerRenderCoordinator';
import { walkLayerTree } from '../document/layerTree';
import type { TextRenderPresentationSnapshot } from '../../application/rendering/rendererTypes';
export type { TextRenderPresentationSnapshot } from '../../application/rendering/rendererTypes';

export interface LayerDocumentRendererRuntime {
  textureCodec: LayerTextureCodec;
  layerResources: LayerRuntimeStore;
  patternAssets: PatternAssetStore;
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
  resizeSurface(width: number, height: number): void;
  imageResize: ImageResizeGpuService;
  documentGeometry: DocumentGeometryGpuService;
  layerPresentationPicker: LayerPresentationPicker;
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
  onTextRenderPresentation: (snapshot: TextRenderPresentationSnapshot) => void = () => undefined,
  onTextRenderError: (message: string) => void = () => undefined,
  documentLayerResources?: DocumentLayerResourceRepository,
  documentPatternResources?: DocumentPatternResourceRepository
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
    adobeRgbDecode: pipelines.adobeRgbDecode,
    maskDecode: pipelines.maskDecode,
    exportLayer: pipelines.exportLayer
  });
  const layerResources = new LayerRuntimeStore({
    createRasterTexture: (label, width, height) =>
      textures.createColorSized(label, width, height),
    createMaskTexture: (label) => textures.createMask(label)
  }, documentLayerResources);
  const patternAssets = new PatternAssetStore(documentPatternResources);
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
    createTextureSized: (label, width, height) => textures.createColorSized(label, width, height),
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
    onChanged: onTextRenderPresentation,
    onError: onTextRenderError
  });
  const layerPresentationPicker = new LayerPresentationPicker({
    device,
    layers: layerResources,
    styles: layerStyleRenderer,
    texts: textLayerRenderer,
    textCoordinator: textLayerCoordinator
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
      const raster = layerResources.raster(layerId);
      return raster ? {
        texture: raster.texture,
        width: raster.width,
        height: raster.height
      } : null;
    },
    maskTexture: (layerId) => layerResources.maskTexture(layerId),
    encode: (source, maskChannel, width, height, sourceToOutput) =>
      textureCodec.encode(source, maskChannel, width, height, sourceToOutput)
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
    clearTexture: (encoder, texture) => textures.clear(encoder, texture),
    invalidateLayer: (layerId) => renderResources.invalidateLayer(layerId),
    drawFullscreen: (encoder, pipeline, bindGroup, target, clearValue) =>
      textures.drawFullscreen(encoder, pipeline, bindGroup, target, clearValue)
  });
  const pixelEditHistory = new PixelEditHistoryService({
    device,
    layerResources,
    sessions: pixelEditSessions,
    dimensions: resources.dimensions,
    createTextureSized: (label, width, height) =>
      textures.createColorSized(label, width, height),
    createMaskTextureSized: (label, width, height) =>
      textures.createMaskSized(label, width, height),
    maskTextureFor: (layerId) => layerResources.maskTexture(layerId),
    invalidateLayer: (layerId) => renderResources.invalidateLayer(layerId)
  });
  const rasterPaint = new RasterPaintService({
    device,
    sampler,
    layerResources,
    selectionTextures,
    dimensions: resources.dimensions,
    brushPipelines: toolPipelines.getBrush,
    pipelines: toolPipelines.get,
    ensureSelectionTargets,
    createTextureSized: (label, width, height) =>
      textures.createColorSized(label, width, height),
    createMaskTexture: (label) => textures.createMask(label),
    maskTextureFor: (layerId) => layerResources.maskTexture(layerId),
    invalidateLayer: (layerId) => renderResources.invalidateLayer(layerId),
    captureHistoryRegions: (layerId, channel, regions) =>
      pixelEditHistory.captureRegions(layerId, channel, regions),
    captureAllHistory: (layerId, channel) =>
      pixelEditHistory.captureAll(layerId, channel),
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
    createCoverageTexture: (label, width, height) =>
      textures.createMaskSized(label, width, height),
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
      || (layerDerivedPreviewIsCurrent(layer) && Boolean(layerResources.derivedPreview(layer.id)))
  });
  const documentAssets = new LayerDocumentAssetService({
    rasterTexture: (layerId) => layerResources.raster(layerId)?.texture ?? null,
    derivedPreviewTexture: (layerId) => layerResources.derivedPreview(layerId)?.texture ?? null,
    maskTexture: (layerId) => layerResources.maskTexture(layerId),
    encodeTexture: (layerId, texture, maskChannel, output) => {
      const { width, height } = maskChannel
        ? resources.dimensions()
        : layerResources.raster(layerId)
          ?? layerResources.derivedPreview(layerId)
          ?? resources.dimensions();
      return textureCodec.encode(
        texture,
        maskChannel,
        output?.width ?? width,
        output?.height ?? height,
        output?.sourceToOutput
      );
    },
    encodeSemanticLayer: async (document, layer) => {
      if (layer.type === 'text') {
        const source = textLayerRenderer.resolveExact(layer);
        if (source) {
          return textureCodec.encode(
            source.texture,
            false,
            document.width,
            document.height,
            source.transform
          );
        }
        const texture = textures.createColorSized(
          `LightTable PSD atlas cache: ${layer.name}`,
          document.width,
          document.height
        );
        try {
          const encoder = device.createCommandEncoder({
            label: `LightTable PSD atlas cache: ${layer.name}`
          });
          textures.clear(encoder, texture, { r: 0, g: 0, b: 0, a: 0 });
          if (!textLayerRenderer.encodeAtlasPresentation(
            encoder,
            layer,
            identityAffineMatrix(),
            { texture, width: document.width, height: document.height }
          )) {
            throw new Error(`Exact text source is unavailable for PSD export: ${layer.name}`);
          }
          device.queue.submit([encoder.finish()]);
          return await textureCodec.encode(texture, false, document.width, document.height);
        } finally {
          texture.destroy();
        }
      }
      const encoder = device.createCommandEncoder({
        label: `LightTable PSD semantic cache: ${layer.name}`
      });
      const isolated = {
        ...layer,
        visible: true,
        opacity: 1,
        fillOpacity: 1,
        blendMode: 'normal' as const,
        clipping: false,
        mask: null,
        styleStack: { ...layer.styleStack, enabled: false }
      };
      const texture = compositor.encode(encoder, {
        ...document,
        layers: [isolated],
        activeLayerId: isolated.id
      });
      device.queue.submit([encoder.finish()]);
      renderResources.releaseAfterSubmit();
      return textureCodec.encode(texture, false, document.width, document.height);
    },
    encodeProcessedRasterLayer: async (_document, layer, encodeAdjustment, output) => {
      const source = layerResources.raster(layer.id)?.texture;
      if (!source) throw new Error(`Layer ${layer.name} is not available for PSD export.`);
      const encoder = device.createCommandEncoder({
        label: `LightTable PSD processed raster cache: ${layer.name}`
      });
      const processed = encodeAdjustment(encoder, source, layer);
      device.queue.submit([encoder.finish()]);
      const blob = await textureCodec.encode(
        processed,
        false,
        output.width,
        output.height,
        output.sourceToOutput
      );
      renderResources.releaseAfterSubmit();
      return blob;
    },
    decodeTexture: async (layerId, blob, texture, maskChannel) => {
      const generation = resources.generation();
      const { width, height } = maskChannel
        ? resources.dimensions()
        : layerResources.raster(layerId)
          ?? layerResources.derivedPreview(layerId)
          ?? resources.dimensions();
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
      // Opening/replacing an image resets document-owned text sources, but the
      // coordinator itself remains reusable for the lifetime of the GPU engine.
      () => textLayerCoordinator.resetDocument(),
      () => compositor.destroyCaches(),
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
      () => compositor.topmostSuffixCacheTelemetry().bytes,
      ({ width, height }) =>
        selectionTextures.estimatedTextureBytes(width, height),
      ({ rgba16Bytes }) =>
        pixelEditSessions.estimatedTextureBytes(rgba16Bytes),
      ({ rgba16Bytes, r8Bytes }) =>
        transformSessions.estimatedTextureBytes(rgba16Bytes, r8Bytes)
    ]
  });
  const imageResize = new ImageResizeGpuService({
    device,
    layers: layerResources,
    selection: selectionTextures,
    invalidateAll: () => {
      renderResources.invalidateAllStyles();
      compositor.destroyCaches();
      compositeTargets.destroy();
    }
  });
  const documentGeometry = new DocumentGeometryGpuService({
    device, layers: layerResources, selection: selectionTextures,
    invalidateAll: () => {
      renderResources.invalidateAllStyles();
      compositor.destroyCaches();
      compositeTargets.destroy();
    }
  });

  return {
    textureCodec,
    layerResources,
    patternAssets,
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
    textLayerCoordinator,
    imageResize,
    documentGeometry,
    layerPresentationPicker,
    resizeSurface: (width, height) => {
      resources.setDimensions(width, height);
      compositor.destroyCaches();
      compositeTargets.destroy();
      renderResources.invalidateAllStyles();
      renderResources.releaseStyleTargets();
      geometryPreviews.clear();
    }
  };
};
