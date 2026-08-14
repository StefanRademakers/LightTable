import {
  layerIsLocked,
  type ImageDocument,
  type LayerId,
  type LayerNode,
  type Rect,
  type RasterLayer
} from '../document/documentTypes';
import type { BrushDab, BrushEngine, BrushTipDefinition } from '../tools/brush/strokeBuilder';
import type { PaintChannel } from '../session/editorSession';
import type {
  CompositeSelectionChannel,
  MagicWandOptions,
  SelectionCombineMode,
  SelectionPoint,
  SelectionMode,
  SelectionShape
} from '../selection/selectionTypes';
import type { SelectionCoverageBounds } from '../selection/selectionCoverage';
import type { DocumentAssetBlob } from '../persistence/layeredDocumentFormat';
import type { AffineMatrix } from '../tools/transform/transformTypes';
import { findDocumentLayer } from '../document/layerTree';
import { invertMatrix, multiplyMatrices } from '../tools/transform/affine';
import type { TextLayerEditingLayout } from '../../text/rendering/TextLayerRenderCoordinator';
import {
  identityAffineMatrix,
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
  type RasterGradientBlendMode,
  type RasterGradientPaint,
  type TextFontRuntimePort,
  type TextRenderPresentationSnapshot
} from './createLayerDocumentRendererRuntime';
import type { ResizePlan } from '../document/imageResizeTypes';
import type {
  PaintBrushStrokePlan,
  SampledBrushStrokePlan
} from '../tools/paint/sampledBrushTypes';
import { sampledBrushSourceDocument } from '../document/sampledBrushSourceDocument';

export const projectTextEditingGeometryPreview = (
  presentation: TextLayerEditingLayout,
  canonicalLocal: AffineMatrix,
  previewLocal: AffineMatrix
): TextLayerEditingLayout => {
  const inverseLocal = invertMatrix(canonicalLocal);
  if (!inverseLocal) return presentation;
  return {
    ...presentation,
    localToDocument: multiplyMatrices(
      multiplyMatrices(presentation.localToDocument, inverseLocal), previewLocal
    )
  };
};

export class LayerDocumentRenderer {
  private readonly runtime: LayerDocumentRendererRuntime;
  private document: ImageDocument | null = null;

  constructor(
    private readonly device: GPUDevice,
    sampler: GPUSampler,
    onDevelopmentTextFixtureChanged?: Parameters<typeof createLayerDocumentRendererRuntime>[2],
    onTextRenderPresentation?: (snapshot: TextRenderPresentationSnapshot) => void,
    onTextRenderError?: (message: string) => void
  ) {
    this.runtime = createLayerDocumentRendererRuntime(
      device,
      sampler,
      onDevelopmentTextFixtureChanged,
      onTextRenderPresentation,
      onTextRenderError
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
    this.document = document;
    // Keep detached runtimes alive for the bounded editor history. This makes
    // delete/create/duplicate undo lossless without a synchronous GPU readback.
    // All cached runtimes are released when the image/editor is destroyed.
    this.runtime.layerRuntimeCoordinator.sync(document);
    this.runtime.textLayerCoordinator.sync(document);
  }

  resizeSurface(width: number, height: number) {
    this.runtime.resizeSurface(width, height);
  }

  resizeImagePixels(document: ImageDocument, plan: ResizePlan, noiseReduction: number) {
    return this.runtime.imageResize.resize(document, plan, noiseReduction);
  }

  configureTextFonts(port: TextFontRuntimePort | null) {
    this.runtime.textLayerCoordinator.configureFonts(port);
  }

  setActive(active: boolean) {
    this.runtime.textLayerCoordinator.setActive(active);
  }

  textEditingLayout(layerId: LayerId) {
    const presentation = this.runtime.textLayerCoordinator.editingLayout(layerId);
    const layer = this.document ? findDocumentLayer(this.document, layerId) : null;
    if (!presentation || !layer) return presentation;
    const preview = this.runtime.geometryPreviews.resolve(layer.id, layer.geometryRevision);
    if (!preview) return presentation;
    // The text coordinator publishes parent * canonical-local. The compositor
    // replaces canonical-local with the live geometry preview, so mirror that
    // exact transform for caret, selection and paragraph frame overlays.
    return projectTextEditingGeometryPreview(presentation, layer.transform, preview);
  }

  setTextLayerInteraction(layerId: LayerId, active: boolean) {
    return this.runtime.textLayerCoordinator.setLayerInteraction(layerId, active);
  }

  beginTextInput(layerId: LayerId, startedAt: number) {
    return this.runtime.textLayerCoordinator.beginTextInput(layerId, startedAt);
  }

  markTextFrameSubmitted(document: ImageDocument, submittedAt: number) {
    return this.runtime.textLayerCoordinator.markFrameSubmitted(document, submittedAt);
  }

  markTextFrameGpuComplete(inputIds: readonly number[], completedAt: number) {
    return this.runtime.textLayerCoordinator.markFrameGpuComplete(inputIds, completedAt);
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

  setGeometryPreview(layer: Pick<LayerNode, 'id' | 'geometryRevision'>, matrix: AffineMatrix | null) {
    return this.runtime.geometryPreviews.set(layer.id, layer.geometryRevision, matrix);
  }

  clearGeometryPreviews() {
    return this.runtime.geometryPreviews.clear();
  }

  setLayerStyleInteractionActive(active: boolean, layerId?: LayerId) {
    return this.runtime.layerStyleRenderer.setInteractionLayer(active ? layerId ?? null : null);
  }

  encodeComposite(
    encoder: GPUCommandEncoder,
    document: ImageDocument,
    encodeAdjustment?: EncodeAdjustment,
    includeDevelopmentTextFixture = false,
    excludedLayerIds: ReadonlySet<LayerId> = new Set()
  ): GPUTexture {
    return this.runtime.compositor.encode(
      encoder,
      document,
      encodeAdjustment,
      includeDevelopmentTextFixture,
      excludedLayerIds
    );
  }

  /** Resolves the top painted layer from retained presentation sources. */
  pickTopLayerAtPoint(
    document: ImageDocument,
    layerIds: readonly LayerId[],
    point: SelectionPoint,
    knownOpaqueLayerIds: ReadonlySet<LayerId> = new Set()
  ) {
    return this.runtime.layerPresentationPicker.pickTopLayerAtPoint(
      document, layerIds, point, knownOpaqueLayerIds
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
    this.runtime.textLayerCoordinator.retireSubmittedResources();
  }

  duplicateLayer(sourceId: LayerId, destinationId: LayerId) {
    return this.runtime.rasterDocumentOperations.duplicate(sourceId, destinationId);
  }

  async exportDocumentAssets(document: ImageDocument): Promise<DocumentAssetBlob[]> {
    return this.runtime.documentAssets.export(document);
  }

  async exportPsdDocumentAssets(
    document: ImageDocument,
    encodeAdjustment?: EncodeAdjustment
  ): Promise<DocumentAssetBlob[]> {
    return this.runtime.documentAssets.exportPsd(document, encodeAdjustment);
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

  async exportLayerForBackgroundRemoval(
    document: ImageDocument,
    layer: RasterLayer,
    encodeAdjustment?: EncodeAdjustment
  ) {
    const isolated: RasterLayer = {
      ...layer,
      visible: true,
      opacity: 1,
      fillOpacity: 1,
      blendMode: 'normal',
      clipping: false,
      mask: null,
      styleStack: { ...layer.styleStack, enabled: false }
    };
    const encoder = this.device.createCommandEncoder({
      label: `LightTable background removal source: ${layer.name}`
    });
    const source = this.encodeComposite(
      encoder,
      { ...document, layers: [isolated], activeLayerId: isolated.id },
      encodeAdjustment
    );
    this.device.queue.submit([encoder.finish()]);
    this.releaseSubmittedResources();
    return this.runtime.textureCodec.encode(source, false, document.width, document.height);
  }

  vectorPathsForTextLayer(layerId: LayerId, signal?: AbortSignal) {
    return this.runtime.textLayerCoordinator.vectorPathsForLayer(layerId, signal);
  }

  waitForTextSourcesForExport() {
    return this.runtime.textLayerCoordinator.waitForFinalOutputSources();
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
    if (channel === 'mask' && !layer.mask) throw new Error('Add a layer mask before painting the mask channel.');
    this.beginPixelEdit(layer.id, channel);
  }

  preparePaintTool() {
    this.runtime.rasterPaint.prepareBrushResources();
  }

  prepareMagicWandTool() {
    return this.runtime.selectionRasterizer.prepareMagicWand();
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

  beginSampledBrushStroke(
    document: ImageDocument,
    plan: SampledBrushStrokePlan,
    encodeAdjustment?: EncodeAdjustment
  ) {
    const sourceDocument = sampledBrushSourceDocument(
      document,
      plan.source,
      plan.sampleMode
    );
    if (!sourceDocument) {
      throw new Error('The sampled source layer is no longer available.');
    }
    const encoder = this.device.createCommandEncoder({
      label: `LightTable ${plan.operator} source snapshot`
    });
    const composite = this.encodeComposite(encoder, sourceDocument, encodeAdjustment);
    const snapshot = this.device.createTexture({
      label: `LightTable ${plan.operator} immutable source`,
      size: [document.width, document.height],
      format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING
        | GPUTextureUsage.COPY_DST
        | GPUTextureUsage.COPY_SRC
        | GPUTextureUsage.RENDER_ATTACHMENT
    });
    encoder.copyTextureToTexture(
      { texture: composite },
      { texture: snapshot },
      [document.width, document.height]
    );
    this.device.queue.submit([encoder.finish()]);
    this.runtime.rasterPaint.beginSampledStroke(
      snapshot,
      document.width,
      document.height,
      plan
    );
    this.releaseSubmittedResources();
  }

  endSampledBrushStroke() {
    this.runtime.rasterPaint.endSampledStroke();
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
    transform: AffineMatrix = identityAffineMatrix(),
    preserveTransparency = false,
    tip?: BrushTipDefinition,
    engine: BrushEngine = 'paint',
    operator?: PaintBrushStrokePlan
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
      transform,
      preserveTransparency,
      tip,
      engine,
      operator
    );
  }

  fillLayerColor(
    layerId: LayerId,
    channel: PaintChannel,
    color: [number, number, number],
    preserveTransparency: boolean,
    transform: AffineMatrix = identityAffineMatrix(),
    opacity = 1
  ) {
    return this.runtime.rasterPaint.fillColor(
      layerId,
      channel,
      color,
      preserveTransparency,
      transform,
      opacity
    );
  }

  fillLayerGradient(
    layerId: LayerId,
    channel: PaintChannel,
    paint: RasterGradientPaint,
    opacity: number,
    blendMode: RasterGradientBlendMode,
    preserveTransparency: boolean,
    transform: AffineMatrix = identityAffineMatrix()
  ) {
    return this.runtime.rasterPaint.fillGradient(
      layerId,
      channel,
      paint,
      opacity,
      blendMode,
      preserveTransparency,
      transform
    );
  }

  invertLayerColors(layerId: LayerId, channel: PaintChannel = 'pixels') {
    return this.runtime.rasterPaint.invertColors(layerId, channel);
  }

  bakeSelectionIntoLayerMask(layerId: LayerId) {
    const target = this.maskTextureFor(layerId);
    if (!target) return false;
    this.runtime.pixelEditHistory.captureAll(layerId, 'mask');
    return this.runtime.selectionRasterizer.copySelectionToMask(target);
  }

  applyGeneratedLayerMask(
    layerId: LayerId,
    mask: import('../selection/selectionTypes').RasterSelectionMask,
    mode: 'replace' | 'intersect'
  ) {
    const target = this.maskTextureFor(layerId);
    if (!target) return false;
    // Generated masks are a single semantic operation, but their pixels live
    // only on the GPU. Capture the current mask before uploading the result so
    // finishPixelEdit() can publish one atomic, recoverable undo step.
    this.runtime.pixelEditHistory.captureAll(layerId, 'mask');
    return this.runtime.selectionRasterizer.applyLayerMask(target, mask, mode);
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

  loadRasterLayerTransparencyAsSelection(document: ImageDocument, layer: RasterLayer) {
    const encoder = this.device.createCommandEncoder({
      label: 'LightTable load layer transparency as selection'
    });
    // The RGB thumbnail represents intrinsic layer pixels. Isolate them in
    // document space so tight rasters, offsets and transforms are honored,
    // while visibility, opacity, masks, effects and local grading do not
    // silently alter the Photoshop-compatible transparency selection.
    const isolatedLayer: RasterLayer = {
      ...layer,
      visible: true,
      opacity: 1,
      fillOpacity: 1,
      blendMode: 'normal',
      clipping: false,
      adjustmentStack: null,
      mask: null,
      styleStack: { ...layer.styleStack, enabled: false }
    };
    const source = this.encodeComposite(encoder, {
      ...document,
      layers: [isolatedLayer],
      activeLayerId: layer.id
    });
    this.device.queue.submit([encoder.finish()]);
    this.releaseSubmittedResources();
    return this.runtime.selectionRasterizer.loadTransparency(source);
  }

  applyMagicWandToTexture(
    source: GPUTexture,
    point: SelectionPoint,
    options: MagicWandOptions,
    mode: SelectionCombineMode
  ) {
    return this.runtime.selectionRasterizer.magicWand(source, point, options, mode);
  }

  applyRasterSelectionMask(
    mask: import('../selection/selectionTypes').RasterSelectionMask,
    mode: SelectionCombineMode
  ) {
    return this.runtime.selectionRasterizer.applyRasterMask(mask, mode);
  }

  applyMagicWandToActiveLayer(
    document: ImageDocument,
    layerId: LayerId,
    point: SelectionPoint,
    options: MagicWandOptions,
    mode: SelectionCombineMode
  ) {
    const layer = findDocumentLayer(document, layerId);
    if (!layer) return false;
    const encoder = this.device.createCommandEncoder({
      label: 'LightTable isolate active layer for Magic Wand'
    });
    const source = this.encodeComposite(encoder, {
      ...document,
      layers: [layer],
      activeLayerId: layer.id
    });
    this.device.queue.submit([encoder.finish()]);
    const applied = this.runtime.selectionRasterizer.magicWand(source, point, options, mode);
    this.releaseSubmittedResources();
    return applied;
  }

  setSelection(
    shape: SelectionShape,
    requestedMode: SelectionMode,
    featherRadius = 0,
    antiAlias = false
  ) {
    return this.runtime.selectionRasterizer.set(
      shape,
      requestedMode,
      featherRadius,
      antiAlias
    );
  }

  featherSelection(radius: number) {
    return this.runtime.selectionRasterizer.feather(radius);
  }

  transformSelection(matrix: { a: number; b: number; c: number; d: number; tx: number; ty: number }) {
    return this.runtime.selectionRasterizer.transform(matrix);
  }

  setDuplicateLayerTransform(duplicate: boolean) {
    return this.runtime.transformRasterizer.setDuplicateSelection(duplicate);
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

  async exportSelectionMask() {
    return this.runtime.selectionClipboard.exportSelectionMask();
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

  async measureLayerMaskContent(layer: RasterLayer): Promise<SelectionCoverageBounds | null> {
    return this.runtime.selectionContentAnalyzer.measureMask(layer);
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
    this.runtime.textLayerCoordinator.dispose();
    this.runtime.rasterPaint.destroy();
    this.runtime.selectionRasterizer.destroy();
    this.runtime.renderResources.destroyPending();
  }
}
