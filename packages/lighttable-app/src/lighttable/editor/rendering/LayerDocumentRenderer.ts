import {
  layerIsLocked,
  type ImageDocument,
  type LayerId,
  type LayerNode,
  type Rect,
  type RasterLayer
} from '../document/documentTypes';
import type { BrushDab } from '../tools/brush/strokeBuilder';
import type { PaintChannel } from '../session/editorSession';
import type {
  CompositeSelectionChannel,
  SelectionMode,
  SelectionShape
} from '../selection/selectionTypes';
import type { SelectionCoverageBounds } from '../selection/selectionCoverage';
import type { DocumentAssetBlob } from '../persistence/layeredDocumentFormat';
import type { AffineMatrix } from '../tools/transform/transformTypes';
import {
  identityAffineMatrix,
  isIdentityAffineMatrix,
  type RasterRenderContract
} from './renderContract';
import {
  type EncodeAdjustment
} from './RasterDocumentOperations';
import type { ReversiblePixelEdit } from '../history/ReversiblePixelEdit';
import type { LayerThumbnailBlob } from './LayerThumbnailService';
import {
  createLayerDocumentRendererRuntime,
  type LayerDocumentRendererRuntime,
  type TextFontRuntimePort,
  type TextRenderPresentationSnapshot
} from './createLayerDocumentRendererRuntime';

export class LayerDocumentRenderer {
  private readonly runtime: LayerDocumentRendererRuntime;

  constructor(
    device: GPUDevice,
    sampler: GPUSampler,
    onDevelopmentTextFixtureChanged?: Parameters<typeof createLayerDocumentRendererRuntime>[2],
    onTextRenderPresentation?: (snapshot: TextRenderPresentationSnapshot) => void
  ) {
    this.runtime = createLayerDocumentRendererRuntime(
      device,
      sampler,
      onDevelopmentTextFixtureChanged,
      onTextRenderPresentation
    );
  }

  async initializeLayerStylePipeline() {
    await this.runtime.layerStyleRenderer.initialize();
  }

  async layerStyleShaderErrors() {
    return this.runtime.layerStyleRenderer.shaderErrors();
  }

  initialize(document: ImageDocument, sourceTexture: GPUTexture) {
    this.runtime.imageResources.begin(document.width, document.height);
    this.syncDocument(document);
    this.runtime.importedLayerInitializer.initialize(document, sourceTexture);
  }

  syncDocument(document: ImageDocument) {
    // Keep detached runtimes alive for the bounded editor history. This makes
    // delete/create/duplicate undo lossless without a synchronous GPU readback.
    // All cached runtimes are released when the image/editor is destroyed.
    this.runtime.layerRuntimeCoordinator.sync(document);
    this.runtime.textLayerCoordinator.sync(document);
  }

  configureTextFonts(port: TextFontRuntimePort | null) {
    this.runtime.textLayerCoordinator.configureFonts(port);
  }

  textEditingLayout(layerId: LayerId) {
    return this.runtime.textLayerCoordinator.editingLayout(layerId);
  }

  pruneDetachedRuntimes(
    keepRasterLayerIds: ReadonlySet<LayerId>,
    keepMaskLayerIds: ReadonlySet<LayerId>
  ) {
    this.runtime.layerRuntimeCoordinator.pruneDetached(keepRasterLayerIds, keepMaskLayerIds);
  }

  private maskTextureFor(layerId: LayerId) {
    return this.runtime.layerResources.maskTexture(layerId);
  }

  /**
   * Borrows the live document-owned mask texture for presentation. Callers
   * must never destroy it; its lifetime remains owned by the layer runtime.
   */
  maskPresentationTexture(layerId: LayerId) {
    return this.maskTextureFor(layerId);
  }

  resolveRasterRenderContract(layer: RasterLayer): RasterRenderContract | null {
    return this.runtime.layerRuntimeCoordinator.resolveRenderContract(layer);
  }

  /**
   * WebGPU deliberately exposes no driver VRAM counter. Keep this estimate
   * tied to the textures this renderer actually owns, including detached
   * raster runtimes retained for lossless undo.
   */
  estimatedTextureBytes() {
    return this.runtime.textureMemory.estimate();
  }

  setGeometryPreview(layer: RasterLayer, matrix: AffineMatrix | null) {
    return this.runtime.geometryPreviews.set(layer.id, layer.geometryRevision, matrix);
  }

  clearGeometryPreviews() {
    return this.runtime.geometryPreviews.clear();
  }

  setLayerStyleInteractionActive(active: boolean) {
    return this.runtime.layerStyleRenderer.setInteractionActive(active);
  }

  encodeComposite(
    encoder: GPUCommandEncoder,
    document: ImageDocument,
    encodeAdjustment?: EncodeAdjustment,
    includeDevelopmentTextFixture = false
  ): GPUTexture {
    return this.runtime.compositor.encode(
      encoder,
      document,
      encodeAdjustment,
      includeDevelopmentTextFixture
    );
  }

  setDevelopmentTextFixtureEnabled(enabled: boolean) {
    return this.runtime.developmentTextFixture.setEnabled(enabled);
  }

  handleDeviceLoss() {
    this.runtime.developmentTextFixture.handleDeviceLoss();
    this.runtime.textLayerCoordinator.dispose();
  }

  private ensureSelectionTargets() {
    this.runtime.selectionTextures.ensureTargets();
  }

  selectionMaskTexture() {
    const textures = this.runtime.selectionTextures;
    return textures.active ? textures.mask : null;
  }

  releaseSubmittedResources() {
    this.runtime.renderResources.releaseAfterSubmit();
    void this.runtime.vectorLayerRenderer.notifySubmitted();
    this.runtime.developmentTextFixture.retireSubmittedResources();
  }

  duplicateLayer(sourceId: LayerId, destinationId: LayerId) {
    return this.runtime.rasterDocumentOperations.duplicate(sourceId, destinationId);
  }

  async exportDocumentAssets(document: ImageDocument): Promise<DocumentAssetBlob[]> {
    return this.runtime.documentAssets.export(document);
  }

  async exportLayerThumbnail(
    layerId: LayerId,
    maskChannel = false,
    maximumWidth = 80,
    maximumHeight = 80
  ): Promise<LayerThumbnailBlob | null> {
    if (!maskChannel && this.runtime.textLayerCoordinator.hasTextLayer(layerId)) {
      await this.runtime.textLayerCoordinator.waitForSettledSource(layerId);
    }
    return this.runtime.layerThumbnails.export(
      layerId,
      maskChannel,
      maximumWidth,
      maximumHeight
    );
  }

  async loadDocumentAssets(assets: DocumentAssetBlob[]) {
    await this.runtime.documentAssets.load(assets);
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
    return this.runtime.rasterDocumentOperations.merge(
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
    return this.runtime.rasterDocumentOperations.flattenGroup(
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
    return this.runtime.rasterDocumentOperations.flattenImage(
      document,
      destinationId,
      encodeAdjustment
    );
  }

  prepareRasterDestination(destination: RasterLayer) {
    return this.runtime.rasterDocumentOperations.prepareRasterDestination(destination);
  }

  commitRasterDestination(layerId: LayerId) {
    this.runtime.rasterDocumentOperations.commitRasterDestination(layerId);
  }

  releaseRasterDestination(layerId: LayerId) {
    return this.runtime.rasterDocumentOperations.releaseRasterDestination(layerId);
  }

  rasterizeText(
    document: ImageDocument,
    source: import('../document/documentTypes').TextLayer,
    destination: RasterLayer
  ) {
    return this.runtime.rasterDocumentOperations.rasterizeText(
      document,
      source,
      destination
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
    return this.runtime.pixelEditHistory.begin(layerId, channel);
  }

  finishPixelEdit(): ReversiblePixelEdit | null {
    return this.runtime.pixelEditHistory.finish();
  }

  cancelPixelEdit() {
    return this.runtime.pixelEditHistory.cancel();
  }

  beginTransform(layer: RasterLayer, useSelection: boolean) {
    return this.runtime.transformRasterizer.begin(layer, useSelection);
  }

  updateTransform(matrix: AffineMatrix) {
    return this.runtime.transformRasterizer.update(matrix);
  }

  updateProjectiveTransform(source: import('../tools/transform/transformTypes').TransformQuad, destination: import('../tools/transform/transformTypes').TransformQuad) {
    return this.runtime.transformRasterizer.updateProjective(source, destination);
  }

  commitTransform(): ReversiblePixelEdit | null {
    return this.runtime.transformRasterizer.commit();
  }

  cancelTransform() {
    return this.runtime.transformRasterizer.cancel();
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
    return this.runtime.rasterPaint.paintDabs(
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
    return this.runtime.rasterPaint.fillColor(
      layerId,
      channel,
      color,
      preserveTransparency,
      transform
    );
  }

  invertLayerColors(layerId: LayerId, channel: PaintChannel = 'pixels') {
    return this.runtime.rasterPaint.invertColors(layerId, channel);
  }

  bakeSelectionIntoLayerMask(layerId: LayerId) {
    const target = this.maskTextureFor(layerId);
    return target
      ? this.runtime.selectionRasterizer.copySelectionToMask(target)
      : false;
  }

  loadLayerMaskAsSelection(layerId: LayerId) {
    const source = this.maskTextureFor(layerId);
    return source
      ? this.runtime.selectionRasterizer.loadMask(source)
      : false;
  }

  loadCompositeChannelAsSelection(source: GPUTexture, channel: CompositeSelectionChannel) {
    return this.runtime.selectionRasterizer.loadColorChannel(source, channel);
  }

  setSelection(shape: SelectionShape, requestedMode: SelectionMode) {
    return this.runtime.selectionRasterizer.set(shape, requestedMode);
  }

  featherSelection(radius: number) {
    return this.runtime.selectionRasterizer.feather(radius);
  }

  copySelectedLayerContent(
    document: ImageDocument,
    layerId: LayerId,
    encodeAdjustment?: EncodeAdjustment
  ) {
    return this.runtime.selectionClipboard.copySelectedLayer(
      document,
      layerId,
      (encoder, isolatedDocument) =>
        this.encodeComposite(encoder, isolatedDocument, encodeAdjustment),
      () => this.releaseSubmittedResources()
    );
  }

  async exportSelectionClipboard(bounds: Rect) {
    return this.runtime.selectionClipboard.exportLayerSelection(bounds);
  }

  async exportDisplaySelection(
    displayTexture: GPUTexture,
    bounds: Rect
  ) {
    return this.runtime.selectionClipboard.exportDisplaySelection(displayTexture, bounds);
  }

  async pasteClipboardImage(
    layerId: LayerId,
    blob: Blob,
    requestedPosition: { x: number; y: number } | null
  ) {
    return this.runtime.selectionClipboard.pasteExternalImage(layerId, blob, requestedPosition);
  }

  async measureSelectedLayerContent(layer: RasterLayer): Promise<SelectionCoverageBounds | null> {
    return this.runtime.selectionContentAnalyzer.measure(layer, true);
  }

  async measureLayerContent(layer: RasterLayer): Promise<SelectionCoverageBounds | null> {
    return this.runtime.selectionContentAnalyzer.measure(layer, false);
  }

  pasteSelectionClipboard(layerId: LayerId) {
    return this.runtime.selectionClipboard.pasteInternal(layerId);
  }

  hasSelectionClipboard() {
    return this.runtime.selectionClipboard.hasInternalClipboard();
  }

  clearSelection() {
    return this.runtime.selectionRasterizer.clear();
  }

  destroyImageResources() {
    this.runtime.imageResources.destroy();
  }

  destroy() {
    this.destroyImageResources();
    this.runtime.rasterPaint.destroy();
    this.runtime.renderResources.destroyPending();
  }
}
