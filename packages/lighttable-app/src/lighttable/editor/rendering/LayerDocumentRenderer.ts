import {
  layerIsLocked,
  type ImageDocument,
  type LayerId,
  type LayerNode,
  type Rect,
  type RasterLayer
} from '../document/documentTypes';
import {
  walkLayerTree
} from '../document/layerTree';
import type { BrushDab } from '../tools/brush/strokeBuilder';
import type { PaintChannel } from '../session/editorSession';
import type { SelectionMode, SelectionShape } from '../selection/selectionTypes';
import type { SelectionCoverageBounds } from '../selection/selectionCoverage';
import type { DocumentAssetBlob } from '../persistence/layeredDocumentFormat';
import type { AffineMatrix } from '../tools/transform/transformTypes';
import {
  identityAffineMatrix,
  isIdentityAffineMatrix,
  rasterRenderContract,
  type RasterRenderContract
} from './renderContract';
import { LayerRuntimeStore } from './LayerRuntimeStore';
import { SubmittedResourceRetainer } from './SubmittedResourceRetainer';
import { RenderTargetPair } from './RenderTargetPair';
import { SelectionTextureStore } from './SelectionTextureStore';
import { TransformSessionStore } from './TransformSessionStore';
import { PixelEditSessionStore } from './PixelEditSessionStore';
import { PatternAssetStore } from './PatternAssetStore';
import {
  toolPipelinesFor,
  type ToolPipelineBundle
} from './ToolPipelineBundle';
import { GeometryPreviewStore } from './GeometryPreviewStore';
import { documentPipelinesFor } from './DocumentPipelineBundle';
import { LayerDocumentAssetService } from './LayerDocumentAssetService';
import { LayerTextureCodec } from './LayerTextureCodec';
import { SelectionRasterizer } from './SelectionRasterizer';
import { SelectionContentAnalyzer } from './SelectionContentAnalyzer';
import { SelectionClipboardService } from './SelectionClipboardService';
import {
  RasterDocumentOperations,
  type EncodeAdjustment
} from './RasterDocumentOperations';
import { LayerStyleRenderer } from './LayerStyleRenderer';
import { LayerCompositor } from './LayerCompositor';
import type { ReversiblePixelEdit } from '../history/ReversiblePixelEdit';
import { TransformRasterizer } from './TransformRasterizer';
import { PixelEditHistoryService } from './PixelEditHistoryService';
import { RasterPaintService } from './RasterPaintService';
import { PatternAssetLoader } from './PatternAssetLoader';
import {
  LayerThumbnailService,
  type LayerThumbnailBlob
} from './LayerThumbnailService';
import { ImportedLayerInitializer } from './ImportedLayerInitializer';
import { DocumentTextureFactory } from './DocumentTextureFactory';
import { DocumentResourceState } from './DocumentResourceState';

export class LayerDocumentRenderer {
  private readonly layerResources: LayerRuntimeStore;
  private readonly patternAssets = new PatternAssetStore();
  private readonly patternAssetLoader: PatternAssetLoader;
  private readonly decodePipeline: GPURenderPipeline;
  private readonly compositePipeline: GPURenderPipeline;
  private readonly adjustmentMixPipeline: GPURenderPipeline;
  private readonly fullscreenModule: GPUShaderModule;
  private toolPipelines: ToolPipelineBundle | null = null;
  private readonly submittedResources: SubmittedResourceRetainer;
  private readonly layerStyleRenderer: LayerStyleRenderer;
  private readonly compositor: LayerCompositor;
  private readonly compositeTargets: RenderTargetPair;
  private readonly selectionTextures: SelectionTextureStore;
  private readonly transformSessions = new TransformSessionStore();
  private readonly pixelEditSessions = new PixelEditSessionStore();
  private readonly documentAssets: LayerDocumentAssetService;
  private readonly textureCodec: LayerTextureCodec;
  private readonly selectionRasterizer: SelectionRasterizer;
  private readonly selectionContentAnalyzer: SelectionContentAnalyzer;
  private readonly selectionClipboard: SelectionClipboardService;
  private readonly transformRasterizer: TransformRasterizer;
  private readonly pixelEditHistory: PixelEditHistoryService;
  private readonly rasterPaint: RasterPaintService;
  private readonly rasterDocumentOperations: RasterDocumentOperations;
  private readonly layerThumbnails: LayerThumbnailService;
  private readonly importedLayerInitializer: ImportedLayerInitializer;
  private readonly textures: DocumentTextureFactory;
  private readonly resources = new DocumentResourceState();
  private readonly geometryPreviews = new GeometryPreviewStore();

  private readonly device: GPUDevice;
  private readonly sampler: GPUSampler;

  constructor(device: GPUDevice, sampler: GPUSampler) {
    this.device = device;
    this.sampler = sampler;
    const pipelines = documentPipelinesFor(device);
    this.decodePipeline = pipelines.decode;
    this.compositePipeline = pipelines.composite;
    this.adjustmentMixPipeline = pipelines.adjustmentMix;
    this.fullscreenModule = pipelines.fullscreenModule;
    this.textures = new DocumentTextureFactory({
      device,
      dimensions: this.resources.dimensions
    });
    this.textureCodec = new LayerTextureCodec(device, sampler, {
      decode: pipelines.decode,
      maskDecode: pipelines.maskDecode,
      exportLayer: pipelines.exportLayer
    });
    this.layerResources = new LayerRuntimeStore({
      createRasterTexture: (label) => this.textures.createColor(label),
      createMaskTexture: (label) => this.textures.createMask(label)
    });
    this.layerThumbnails = new LayerThumbnailService({
      dimensions: this.resources.dimensions,
      rasterTexture: (layerId) => this.layerResources.raster(layerId)?.texture ?? null,
      maskTexture: (layerId) => this.maskTextureFor(layerId),
      encode: (source, maskChannel, width, height) =>
        this.textureCodec.encode(source, maskChannel, width, height)
    });
    this.importedLayerInitializer = new ImportedLayerInitializer({
      device,
      sampler,
      decodePipeline: this.decodePipeline,
      rasterTexture: (layerId) => this.layerResources.raster(layerId)?.texture ?? null,
      drawFullscreen: (encoder, pipeline, bindGroup, target, clearValue) =>
        this.textures.drawFullscreen(encoder, pipeline, bindGroup, target, clearValue)
    });
    this.submittedResources = new SubmittedResourceRetainer({
      onSubmittedWorkDone: () => this.device.queue.onSubmittedWorkDone()
    });
    this.layerStyleRenderer = new LayerStyleRenderer({
      device,
      sampler,
      fullscreenModule: this.fullscreenModule,
      shapePipeline: pipelines.styleShape,
      patternAssets: this.patternAssets,
      submittedResources: this.submittedResources,
      dimensions: this.resources.dimensions,
      createTexture: (label) => this.textures.createColor(label),
      drawFullscreen: (encoder, pipeline, bindGroup, target, clearValue) =>
        this.textures.drawFullscreen(encoder, pipeline, bindGroup, target, clearValue)
    });
    this.patternAssetLoader = new PatternAssetLoader({
      device,
      sampler,
      decodePipeline: this.decodePipeline,
      store: this.patternAssets,
      generation: this.resources.generation,
      invalidateStyledLayers: () => this.releaseStyledLayerCache(),
      drawFullscreen: (encoder, pipeline, bindGroup, target, clearValue) =>
        this.textures.drawFullscreen(encoder, pipeline, bindGroup, target, clearValue)
    });
    this.compositeTargets = new RenderTargetPair({
      createTexture: (label) => this.textures.createColor(label),
      firstLabel: 'LightTable layer composite A',
      secondLabel: 'LightTable layer composite B'
    });
    this.compositor = new LayerCompositor({
      device,
      sampler,
      compositePipeline: this.compositePipeline,
      adjustmentMixPipeline: this.adjustmentMixPipeline,
      layerResources: this.layerResources,
      targets: this.compositeTargets,
      submittedResources: this.submittedResources,
      transformSessions: this.transformSessions,
      pixelEditSessions: this.pixelEditSessions,
      geometryPreviews: this.geometryPreviews,
      layerStyles: this.layerStyleRenderer,
      dimensions: this.resources.dimensions,
      syncDocument: (document) => this.syncDocument(document),
      maskTextureFor: (layerId) => this.maskTextureFor(layerId),
      createTexture: (label) => this.textures.createColor(label),
      clearTexture: (encoder, texture) => this.textures.clear(encoder, texture),
      drawFullscreen: (encoder, pipeline, bindGroup, target, clearValue) =>
        this.textures.drawFullscreen(encoder, pipeline, bindGroup, target, clearValue)
    });
    this.selectionTextures = new SelectionTextureStore({
      createSelectionTexture: (label) => this.textures.createSelection(label),
      createClipboardTexture: (label) => this.textures.createColor(label)
    });
    this.transformRasterizer = new TransformRasterizer({
      device,
      sampler,
      layerResources: this.layerResources,
      selectionTextures: this.selectionTextures,
      sessions: this.transformSessions,
      dimensions: this.resources.dimensions,
      pipelines: () => {
        this.ensureToolPipelines();
        return this.toolPipelines!;
      },
      ensureSelectionTargets: () => this.ensureSelectionTargets(),
      createTexture: (label) => this.textures.createColor(label),
      createSelectionTexture: (label) => this.textures.createSelection(label),
      invalidateLayer: (layerId) => this.invalidateStyledLayerCache(layerId),
      drawFullscreen: (encoder, pipeline, bindGroup, target, clearValue) =>
        this.textures.drawFullscreen(encoder, pipeline, bindGroup, target, clearValue)
    });
    this.pixelEditHistory = new PixelEditHistoryService({
      device,
      layerResources: this.layerResources,
      sessions: this.pixelEditSessions,
      dimensions: this.resources.dimensions,
      createTexture: (label) => this.textures.createColor(label),
      maskTextureFor: (layerId) => this.maskTextureFor(layerId),
      invalidateLayer: (layerId) => this.invalidateStyledLayerCache(layerId)
    });
    this.rasterPaint = new RasterPaintService({
      device,
      layerResources: this.layerResources,
      selectionTextures: this.selectionTextures,
      dimensions: this.resources.dimensions,
      pipelines: () => {
        this.ensureToolPipelines();
        return this.toolPipelines!;
      },
      ensureSelectionTargets: () => this.ensureSelectionTargets(),
      createTexture: (label) => this.textures.createColor(label),
      maskTextureFor: (layerId) => this.maskTextureFor(layerId),
      invalidateLayer: (layerId) => this.invalidateStyledLayerCache(layerId),
      releaseSubmittedResources: () => this.releaseSubmittedResources(),
      drawFullscreen: (encoder, pipeline, bindGroup, target, clearValue) =>
        this.textures.drawFullscreen(encoder, pipeline, bindGroup, target, clearValue)
    });
    this.selectionRasterizer = new SelectionRasterizer({
      device,
      sampler,
      textures: this.selectionTextures,
      dimensions: this.resources.dimensions,
      pipelines: () => {
        this.ensureToolPipelines();
        return this.toolPipelines!;
      },
      ensureTargets: () => this.ensureSelectionTargets(),
      drawFullscreen: (encoder, pipeline, bindGroup, target, clearValue) =>
        this.textures.drawFullscreen(encoder, pipeline, bindGroup, target, clearValue),
      clearTexture: (encoder, texture, clearValue) =>
        this.textures.clear(encoder, texture, clearValue)
    });
    this.selectionContentAnalyzer = new SelectionContentAnalyzer({
      device,
      textures: this.selectionTextures,
      dimensions: this.resources.dimensions,
      generation: this.resources.generation,
      pipelines: () => {
        this.ensureToolPipelines();
        return this.toolPipelines!;
      },
      ensureTargets: () => this.ensureSelectionTargets(),
      rasterRuntime: (layerId) => this.layerResources.raster(layerId),
      createCoverageTexture: (label) => this.textures.createSelection(label),
      drawFullscreen: (encoder, pipeline, bindGroup, target, clearValue) =>
        this.textures.drawFullscreen(encoder, pipeline, bindGroup, target, clearValue)
    });
    this.selectionClipboard = new SelectionClipboardService({
      device,
      textures: this.selectionTextures,
      layerResources: this.layerResources,
      textureCodec: this.textureCodec,
      dimensions: this.resources.dimensions,
      generation: this.resources.generation,
      pipelines: () => {
        this.ensureToolPipelines();
        return this.toolPipelines!;
      },
      invalidateLayer: (layerId) => this.invalidateStyledLayerCache(layerId),
      drawFullscreen: (encoder, pipeline, bindGroup, target, clearValue) =>
        this.textures.drawFullscreen(encoder, pipeline, bindGroup, target, clearValue)
    });
    this.rasterDocumentOperations = new RasterDocumentOperations({
      device,
      layerResources: this.layerResources,
      dimensions: this.resources.dimensions,
      encodeComposite: (encoder, document, encodeAdjustment) =>
        this.encodeComposite(encoder, document, encodeAdjustment),
      invalidateLayer: (layerId) => this.invalidateStyledLayerCache(layerId),
      releaseSubmittedResources: () => this.releaseSubmittedResources()
    });
    this.documentAssets = new LayerDocumentAssetService({
      rasterTexture: (layerId) => this.layerResources.raster(layerId)?.texture ?? null,
      maskTexture: (layerId) => this.maskTextureFor(layerId),
      encodeTexture: (texture, maskChannel) => {
        const { width, height } = this.resources.dimensions();
        return this.textureCodec.encode(texture, maskChannel, width, height);
      },
      decodeTexture: async (blob, texture, maskChannel) => {
        const generation = this.resources.generation();
        const { width, height } = this.resources.dimensions();
        await this.textureCodec.decode(
          blob,
          texture,
          maskChannel,
          width,
          height,
          () => this.resources.isCurrent(generation)
        );
      },
      invalidateLayer: (layerId) => this.invalidateStyledLayerCache(layerId),
      patternSource: (patternId) => this.patternAssets.getSource(patternId),
      loadPattern: (asset) => this.patternAssetLoader.load(asset)
    });
  }

  async initializeLayerStylePipeline() {
    await this.layerStyleRenderer.initialize();
  }

  async layerStyleShaderErrors() {
    return this.layerStyleRenderer.shaderErrors();
  }

  initialize(document: ImageDocument, sourceTexture: GPUTexture) {
    this.destroyImageResources();
    this.resources.setDimensions(document.width, document.height);
    this.selectionTextures.active = false;
    this.syncDocument(document);
    this.importedLayerInitializer.initialize(document, sourceTexture);
  }

  syncDocument(document: ImageDocument) {
    // Keep detached runtimes alive for the bounded editor history. This makes
    // delete/create/duplicate undo lossless without a synchronous GPU readback.
    // All cached runtimes are released when the image/editor is destroyed.
    this.layerResources.sync(document.layers);
  }

  pruneDetachedRuntimes(keepLayerIds: ReadonlySet<LayerId>) {
    this.layerResources.pruneDetached(keepLayerIds).forEach((id) => {
      this.layerStyleRenderer.invalidate(id);
    });
  }

  private maskTextureFor(layerId: LayerId) {
    return this.layerResources.maskTexture(layerId);
  }

  resolveRasterRenderContract(layer: RasterLayer): RasterRenderContract | null {
    const runtime = this.layerResources.raster(layer.id);
    return runtime ? rasterRenderContract(layer, runtime.texture) : null;
  }

  /**
   * WebGPU deliberately exposes no driver VRAM counter. Keep this estimate
   * tied to the textures this renderer actually owns, including detached
   * raster runtimes retained for lossless undo.
   */
  estimatedTextureBytes() {
    const { width, height } = this.resources.dimensions();
    const pixels = Math.max(1, width) * Math.max(1, height);
    const rgba16Bytes = pixels * 8;
    const r8Bytes = pixels;
    let bytes = 0;
    bytes += this.layerResources.estimatedTextureBytes(width, height);
    bytes += this.patternAssets.estimatedTextureBytes();
    bytes += this.layerStyleRenderer.estimatedTextureBytes(width, height);
    bytes += this.compositeTargets.estimatedTextureBytes(width, height, 8);
    bytes += this.selectionTextures.estimatedTextureBytes(width, height);
    bytes += this.pixelEditSessions.estimatedTextureBytes(rgba16Bytes);
    bytes += this.transformSessions.estimatedTextureBytes(rgba16Bytes, r8Bytes);
    return bytes;
  }

  setGeometryPreview(layer: RasterLayer, matrix: AffineMatrix | null) {
    return this.geometryPreviews.set(layer.id, layer.geometryRevision, matrix);
  }

  clearGeometryPreviews() {
    return this.geometryPreviews.clear();
  }

  setLayerStyleInteractionActive(active: boolean) {
    return this.layerStyleRenderer.setInteractionActive(active);
  }

  encodeComposite(
    encoder: GPUCommandEncoder,
    document: ImageDocument,
    encodeAdjustment?: EncodeAdjustment
  ): GPUTexture {
    return this.compositor.encode(encoder, document, encodeAdjustment);
  }

  private releaseStyleTargets() {
    this.layerStyleRenderer.releaseTargets();
  }

  private releaseStyledLayerCache() {
    this.layerStyleRenderer.releaseCache();
  }

  private invalidateStyledLayerCache(layerId: LayerId) {
    this.layerStyleRenderer.invalidate(layerId);
  }

  private ensureSelectionTargets() {
    if (!this.selectionTextures.ensureTargets()) return;
    const encoder = this.device.createCommandEncoder({ label: 'Initialize LightTable selection' });
    this.textures.clear(encoder, this.selectionTextures.mask!, { r: 1, g: 0, b: 0, a: 1 });
    this.textures.clear(encoder, this.selectionTextures.result!, { r: 1, g: 0, b: 0, a: 1 });
    this.textures.clear(encoder, this.selectionTextures.shape!);
    this.device.queue.submit([encoder.finish()]);
  }

  releaseSubmittedResources() {
    this.submittedResources.releaseAfterSubmittedWork();
  }

  duplicateLayer(sourceId: LayerId, destinationId: LayerId) {
    return this.rasterDocumentOperations.duplicate(sourceId, destinationId);
  }

  async exportDocumentAssets(document: ImageDocument): Promise<DocumentAssetBlob[]> {
    return this.documentAssets.export(document);
  }

  async exportLayerThumbnail(
    layerId: LayerId,
    maskChannel = false,
    maximumWidth = 80,
    maximumHeight = 80
  ): Promise<LayerThumbnailBlob | null> {
    return this.layerThumbnails.export(
      layerId,
      maskChannel,
      maximumWidth,
      maximumHeight
    );
  }

  async loadDocumentAssets(assets: DocumentAssetBlob[]) {
    await this.documentAssets.load(assets);
  }

  mergeLayerDown(
    document: ImageDocument,
    topId: LayerId,
    bottomId: LayerId,
    encodeAdjustment?: EncodeAdjustment
  ) {
    return this.mergeLayers(document, [bottomId, topId], bottomId, encodeAdjustment);
  }

  mergeLayers(
    document: ImageDocument,
    layerIds: readonly LayerId[],
    destinationId: LayerId,
    encodeAdjustment?: EncodeAdjustment
  ) {
    return this.rasterDocumentOperations.merge(
      document,
      layerIds,
      destinationId,
      encodeAdjustment
    );
  }

  flattenGroup(
    document: ImageDocument,
    groupId: LayerId,
    destinationId: LayerId,
    encodeAdjustment?: EncodeAdjustment
  ) {
    return this.rasterDocumentOperations.flattenGroup(
      document,
      groupId,
      destinationId,
      encodeAdjustment
    );
  }

  flattenImage(
    document: ImageDocument,
    destinationId: LayerId,
    encodeAdjustment?: EncodeAdjustment
  ) {
    return this.rasterDocumentOperations.flattenImage(
      document,
      destinationId,
      encodeAdjustment
    );
  }

  beginStroke(layer: LayerNode, channel: PaintChannel) {
    if (layerIsLocked(layer, 'pixels') || !layer.visible) throw new Error('Select a visible, unlocked layer before painting.');
    if (channel === 'pixels' && layer.type !== 'raster') {
      throw new Error('Only raster layers have editable pixels.');
    }
    if (channel === 'pixels' && layer.type === 'raster' && !isIdentityAffineMatrix(layer.transform)) {
      throw new Error('Rasterize the transformed layer before painting on it.');
    }
    if (channel === 'mask' && !layer.mask) throw new Error('Add a layer mask before painting the mask channel.');
    this.beginPixelEdit(layer.id, channel);
  }

  beginPixelEdit(layerId: LayerId, channel: PaintChannel) {
    return this.pixelEditHistory.begin(layerId, channel);
  }

  finishPixelEdit(): ReversiblePixelEdit | null {
    return this.pixelEditHistory.finish();
  }

  cancelPixelEdit() {
    return this.pixelEditHistory.cancel();
  }

  beginTransform(layer: RasterLayer, useSelection: boolean) {
    return this.transformRasterizer.begin(layer, useSelection);
  }

  updateTransform(matrix: AffineMatrix) {
    return this.transformRasterizer.update(matrix);
  }

  commitTransform(): ReversiblePixelEdit | null {
    return this.transformRasterizer.commit();
  }

  cancelTransform() {
    return this.transformRasterizer.cancel();
  }

  paintDabs(
    layerId: LayerId,
    channel: PaintChannel,
    dabs: BrushDab[],
    color: [number, number, number],
    hardness: number,
    opacity: number,
    flow: number,
    erase = false,
    transform: AffineMatrix = identityAffineMatrix()
  ) {
    return this.rasterPaint.paintDabs(
      layerId,
      channel,
      dabs,
      color,
      hardness,
      opacity,
      flow,
      erase,
      transform
    );
  }

  fillLayerColor(
    layerId: LayerId,
    channel: PaintChannel,
    color: [number, number, number],
    preserveTransparency: boolean,
    transform: AffineMatrix = identityAffineMatrix()
  ) {
    return this.rasterPaint.fillColor(
      layerId,
      channel,
      color,
      preserveTransparency,
      transform
    );
  }

  invertLayerColors(layerId: LayerId, channel: PaintChannel = 'pixels') {
    return this.rasterPaint.invertColors(layerId, channel);
  }

  setSelection(shape: SelectionShape, requestedMode: SelectionMode) {
    return this.selectionRasterizer.set(shape, requestedMode);
  }

  featherSelection(radius: number) {
    return this.selectionRasterizer.feather(radius);
  }

  copySelectedLayerContent(document: ImageDocument, layerId: LayerId) {
    this.ensureToolPipelines();
    return this.selectionClipboard.copySelectedLayer(
      document,
      layerId,
      (encoder, isolatedDocument) =>
        this.encodeComposite(encoder, isolatedDocument),
      () => this.releaseSubmittedResources()
    );
  }

  async exportSelectionClipboard(bounds: Rect) {
    return this.selectionClipboard.exportLayerSelection(bounds);
  }

  async exportDisplaySelection(
    displayTexture: GPUTexture,
    bounds: Rect
  ) {
    return this.selectionClipboard.exportDisplaySelection(displayTexture, bounds);
  }

  async pasteClipboardImage(
    layerId: LayerId,
    blob: Blob,
    requestedPosition: { x: number; y: number } | null
  ) {
    return this.selectionClipboard.pasteExternalImage(layerId, blob, requestedPosition);
  }

  async measureSelectedLayerContent(layer: RasterLayer): Promise<SelectionCoverageBounds | null> {
    return this.selectionContentAnalyzer.measure(layer, true);
  }

  async measureLayerContent(layer: RasterLayer): Promise<SelectionCoverageBounds | null> {
    return this.selectionContentAnalyzer.measure(layer, false);
  }

  pasteSelectionClipboard(layerId: LayerId) {
    return this.selectionClipboard.pasteInternal(layerId);
  }

  hasSelectionClipboard() {
    return this.selectionClipboard.hasInternalClipboard();
  }

  clearSelection() {
    return this.selectionRasterizer.clear();
  }

  private ensureToolPipelines() {
    this.toolPipelines ??= toolPipelinesFor(this.device);
  }

  destroyImageResources() {
    this.resources.invalidate();
    this.layerResources.destroy();
    this.patternAssets.clear();
    this.layerStyleRenderer.destroy();
    this.compositeTargets.destroy();
    this.selectionTextures.destroy();
    this.geometryPreviews.clear();
    this.cancelTransform();
    this.pixelEditSessions.destroy();
  }

  destroy() {
    this.destroyImageResources();
    this.rasterPaint.destroy();
    this.submittedResources.destroyPending();
  }
}
