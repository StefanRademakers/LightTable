import {
  layerIsLocked,
  type ImageDocument,
  type LayerId,
  type LayerNode,
  type Rect,
  type RasterLayer,
  type VectorLayer
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
import { buildSceneTransformIndex, type SceneTransformIndex } from '../document/sceneTransformGraph';
import { invertMatrix, multiplyMatrices } from '../tools/transform/affine';
import type { TextLayerEditingLayout } from '../../text/rendering/TextLayerRenderCoordinator';
import {
  identityAffineMatrix,
  type RasterRenderContract,
  type Rgba8ImageEncoding
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
import type { DocumentGeometryPlan } from '../../application/documentGeometry/documentGeometryModel';
import type {
  PaintBrushStrokePlan,
  SampledBrushStrokePlan
} from '../tools/paint/sampledBrushTypes';
import { sampledBrushSourceDocument } from '../document/sampledBrushSourceDocument';
import type { SelectionMaskSnapshot } from '../selection/SelectionMaskSnapshot';
import type { SelectionProjectionStage } from './SelectionShapeProjectionService';
import { activeLayerStyleRuntimeOwners } from './layerStyleRuntimeOwners';

interface SelectionPaintPreviewRecord {
  readonly stage: SelectionProjectionStage;
  readonly releaseCommittedLease: () => void;
  retired: boolean;
}

const isolatedLayerTree = (
  nodes: readonly LayerNode[],
  layerId: LayerId
): LayerNode[] => nodes.flatMap((node) => {
  if (node.id === layerId) return [{ ...node, visible: true, blendMode: 'normal', clipping: false }];
  if (node.type !== 'group') return [];
  const children = isolatedLayerTree(node.children, layerId);
  if (children.length === 0) return [];
  return [{
    ...node,
    children,
    visible: true,
    opacity: 1,
    fillOpacity: 1,
    blendMode: 'normal',
    clipping: false,
    styleStack: { ...node.styleStack, enabled: false }
  }];
});

export const projectLayerMaskPresentation = (
  document: ImageDocument | null,
  layer: LayerNode | null,
  texture: GPUTexture | null,
  transform: AffineMatrix | null = null
) => {
  if (!texture || !document || !layer?.mask) return null;
  const inverseTransform = invertMatrix(transform ?? layer.mask.transform);
  if (!inverseTransform) return null;
  return {
    texture,
    inverseTransform,
    canvasWidth: document.width,
    canvasHeight: document.height
  };
};

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
  private selectionPaintPreview: SelectionPaintPreviewRecord | null = null;

  constructor(
    private readonly device: GPUDevice,
    sampler: GPUSampler,
    onDevelopmentTextFixtureChanged?: Parameters<typeof createLayerDocumentRendererRuntime>[2],
    onTextRenderPresentation?: (snapshot: TextRenderPresentationSnapshot) => void,
    onTextRenderError?: (message: string) => void,
    documentLayerResources?: Parameters<typeof createLayerDocumentRendererRuntime>[5],
    documentPatternResources?: Parameters<typeof createLayerDocumentRendererRuntime>[6]
  ) {
    this.runtime = createLayerDocumentRendererRuntime(
      device,
      sampler,
      onDevelopmentTextFixtureChanged,
      onTextRenderPresentation,
      onTextRenderError,
      documentLayerResources,
      documentPatternResources
    );
  }

  setStartupTimeline(timeline: import('../../application/telemetry/documentStartupTimeline').DocumentStartupTimeline | null) {
    this.runtime.vectorLayerRenderer.setStartupTimeline(timeline);
  }

  async initializeLayerStylePipeline() {
    await this.runtime.layerStyleRenderer.initialize();
  }

  async layerStyleShaderErrors() {
    return this.runtime.layerStyleRenderer.shaderErrors();
  }

  initialize(document: ImageDocument, sourceTexture: GPUTexture) {
    this.runtime.layerResources.bind(document.id);
    this.runtime.patternAssets.bind(document.id);
    const retainedPixels = this.runtime.layerResources.hasResources();
    this.runtime.imageResources.begin(document.width, document.height);
    this.syncDocument(document);
    if (!retainedPixels) {
      this.runtime.importedLayerInitializer.initialize(document, sourceTexture);
    }
  }

  syncDocument(document: ImageDocument) {
    this.runtime.layerResources.bind(document.id);
    this.runtime.patternAssets.bind(document.id);
    this.document = document;
    // Keep detached runtimes alive for the bounded editor history. This makes
    // delete/create/duplicate undo lossless without a synchronous GPU readback.
    // All cached runtimes are released when the image/editor is destroyed.
    this.runtime.layerRuntimeCoordinator.sync(document);
    this.runtime.textLayerCoordinator.sync(document);
    this.runtime.layerStyleRenderer.syncOwners(activeLayerStyleRuntimeOwners(document));
  }

  resizeSurface(width: number, height: number) {
    this.runtime.resizeSurface(width, height);
  }

  resizeImagePixels(document: ImageDocument, plan: ResizePlan, noiseReduction: number) {
    return this.runtime.imageResize.resize(document, plan, noiseReduction);
  }

  applyDocumentGeometryPixels(document: ImageDocument, plan: DocumentGeometryPlan) {
    return this.runtime.documentGeometry.transfer(document, plan);
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

  currentTextEditingLayout(layerId: LayerId) {
    const presentation = this.runtime.textLayerCoordinator.currentEditingLayout(layerId);
    const layer = this.document ? findDocumentLayer(this.document, layerId) : null;
    if (!presentation || !layer) return presentation;
    const preview = this.runtime.geometryPreviews.resolve(layer.id, layer.geometryRevision);
    return preview
      ? projectTextEditingGeometryPreview(presentation, layer.transform, preview)
      : presentation;
  }

  waitForTextEditingLayout(layerId: LayerId, signal?: AbortSignal) {
    return this.runtime.textLayerCoordinator.waitForEditingLayout(layerId, signal);
  }

  setTextLayerInteraction(layerId: LayerId, active: boolean) {
    return this.runtime.textLayerCoordinator.setLayerInteraction(layerId, active);
  }

  beginTextInput(layerId: LayerId, startedAt: number) {
    return this.runtime.textLayerCoordinator.beginTextInput(layerId, startedAt);
  }

  resetTextInputTelemetry() {
    this.runtime.textLayerCoordinator.resetInputLatencyTelemetry();
  }

  markTextFrameSubmitted(document: ImageDocument, submittedAt: number) {
    return this.runtime.textLayerCoordinator.markFrameSubmitted(document, submittedAt);
  }

  markTextFrameGpuComplete(inputIds: readonly number[], completedAt: number) {
    return this.runtime.textLayerCoordinator.markFrameGpuComplete(inputIds, completedAt);
  }

  pruneDetachedRuntimes(
    documentResourceKey: string,
    keepRasterLayerIds: ReadonlySet<LayerId>,
    keepMaskLayerIds: ReadonlySet<LayerId>
  ) {
    this.runtime.layerRuntimeCoordinator.pruneDetachedFor(
      documentResourceKey,
      keepRasterLayerIds,
      keepMaskLayerIds
    );
  }

  private maskTextureFor(layerId: LayerId) {
    return this.runtime.layerResources.maskTexture(layerId);
  }

  /**
   * Borrows the live document-owned mask texture and its document-space
   * sampling contract for mask-only presentation. Callers must never destroy
   * the texture; its lifetime remains owned by the layer runtime.
   *
   * A layer mask has its own transform. Returning only the raw texture here
   * makes an Alt/Option-click mask view jump back to its untransformed canvas,
   * even though normal compositing samples it in document space. Keep this
   * contract aligned with the compositor instead of baking a second texture.
   */
  maskPresentation(layerId: LayerId) {
    const texture = this.maskTextureFor(layerId);
    const layer = this.document ? findDocumentLayer(this.document, layerId) : null;
    const preview = layer?.mask
      ? this.runtime.maskGeometryPreviews.resolve(layer.id, layer.mask.revision)
      : null;
    return projectLayerMaskPresentation(this.document, layer, texture, preview);
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

  processingCacheTelemetry() {
    return this.runtime.compositor.topmostSuffixCacheTelemetry();
  }

  vectorBackendTelemetry() {
    const vector = this.runtime.vectorLayerRenderer.backendDiagnostics();
    if (!vector.detailedProfile?.enabled) return vector;
    const islands = this.runtime.compositor.renderIslandTelemetry();
    return {
      ...vector,
      renderIslandPlan: islands.plan,
      detailedProfile: {
        ...vector.detailedProfile,
        phases: {
          ...vector.detailedProfile.phases,
          'render-island-planning': islands.timing,
          'final-layer-composite': this.runtime.compositor.compositeTelemetry()
        }
      }
    };
  }

  resetVectorBackendTelemetry() {
    this.runtime.vectorLayerRenderer.resetBackendTelemetry();
    this.runtime.compositor.resetCompositeTelemetry();
  }

  setTopmostSuffixCacheEnabled(enabled: boolean) {
    this.runtime.compositor.setTopmostSuffixCacheEnabled(enabled);
  }

  setGeometryPreview(layer: Pick<LayerNode, 'id' | 'geometryRevision'>, matrix: AffineMatrix | null) {
    return this.runtime.geometryPreviews.set(layer.id, layer.geometryRevision, matrix);
  }

  setMaskGeometryPreview(
    layer: Pick<LayerNode, 'id' | 'mask'>,
    matrix: AffineMatrix | null
  ) {
    if (!layer.mask) return false;
    return this.runtime.maskGeometryPreviews.set(layer.id, layer.mask.revision, matrix);
  }

  setVectorContentPreviews(layers: readonly VectorLayer[]) {
    return this.runtime.vectorContentPreviews.replace(layers);
  }

  clearVectorContentPreviews() {
    return this.runtime.vectorContentPreviews.clear();
  }

  clearGeometryPreviews() {
    const layersChanged = this.runtime.geometryPreviews.clear();
    const masksChanged = this.runtime.maskGeometryPreviews.clear();
    return layersChanged || masksChanged;
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
    knownOpaqueLayerIds: ReadonlySet<LayerId> = new Set(),
    sceneTransforms?: SceneTransformIndex
  ) {
    return this.runtime.layerPresentationPicker.pickTopLayerAtPoint(
      document, layerIds, point, knownOpaqueLayerIds, sceneTransforms
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

  private assertCommittedSelectionAccess() {
    this.runtime.selectionTextures.assertCommittedAccess();
  }

  selectionMaskTexture() {
    const preview = this.runtime.transformRasterizer.selectionPreviewTexture();
    if (preview) return preview;
    const paintPreview = this.selectionPaintPreview?.stage.textures;
    if (paintPreview?.active) return paintPreview.mask;
    const textures = this.runtime.selectionTextures;
    return textures.active ? textures.mask : null;
  }

  selectionTransformPreviewActive() {
    return Boolean(this.runtime.transformRasterizer.selectionPreviewTexture());
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

  copyLayerMask(sourceId: LayerId, destinationId: LayerId) {
    const source = this.runtime.layerResources.maskTexture(sourceId);
    const destination = this.runtime.layerResources.maskTexture(destinationId);
    const document = this.document;
    if (!source || !destination || !document) return false;
    const encoder = this.device.createCommandEncoder({ label: 'LightTable duplicate layer mask' });
    encoder.copyTextureToTexture(
      { texture: source },
      { texture: destination },
      [document.width, document.height]
    );
    this.device.queue.submit([encoder.finish()]);
    this.runtime.renderResources.releaseAfterSubmit();
    return true;
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
    maximumHeight = 80,
    encoding: Rgba8ImageEncoding = { format: 'png' }
  ): Promise<LayerThumbnailBlob | null> {
    if (!maskChannel && this.runtime.textLayerCoordinator.hasTextLayer(layerId)) {
      await this.runtime.textLayerCoordinator.waitForSettledSource(layerId);
    }
    return this.runtime.layerThumbnails.export(
      layerId,
      maskChannel,
      maximumWidth,
      maximumHeight,
      encoding
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

  /**
   * Encodes one layer (or group subtree) against transparency while retaining
   * its own mask, processing and effects. Ancestor groups only provide spatial
   * context; their visibility, blend and effects cannot alter the requested
   * layer's palette.
   */
  async encodeIsolatedLayer(
    encoder: GPUCommandEncoder,
    document: ImageDocument,
    layerId: LayerId,
    encodeAdjustment?: EncodeAdjustment
  ): Promise<GPUTexture | null> {
    const layers = isolatedLayerTree(document.layers, layerId);
    if (layers.length === 0) return null;
    const layer = findDocumentLayer(document, layerId);
    if (layer?.type === 'text') await this.waitForTextSource(layerId);
    if (layer?.type === 'group') await this.waitForTextSourcesForExport();
    const isolated = { ...document, layers, activeLayerId: layerId };
    // A non-empty exclusion set disables the compositor's document suffix
    // cache. The sentinel matches no real layer and prevents this temporary
    // isolated tree from populating or reusing the normal document cache.
    try {
      return this.encodeComposite(
        encoder, isolated, encodeAdjustment, false,
        new Set<LayerId>(['__lighttable_layer_palette_isolation__' as LayerId])
      );
    } finally {
      this.syncDocument(document);
    }
  }

  vectorPathsForTextLayer(layerId: LayerId, signal?: AbortSignal) {
    return this.runtime.textLayerCoordinator.vectorPathsForLayer(layerId, signal);
  }

  waitForTextSourcesForExport() {
    return this.runtime.textLayerCoordinator.waitForFinalOutputSources();
  }

  waitForTextSource(layerId: LayerId) {
    return this.runtime.textLayerCoordinator.waitForFinalOutputSource(layerId);
  }

  async loadDocumentAssets(assets: DocumentAssetBlob[]) {
    await this.runtime.documentAssets.load(assets);
    // The document is initialized before its persisted raster assets are
    // decoded. A topmost processing suffix may therefore have cached the
    // transparent allocation used during that first composite. Asset upload
    // changes pixels without changing immutable layer-node identities, so the
    // cache contract cannot detect it on its own.
    this.runtime.compositor.destroyCaches();
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

  flattenRenderedImage(
    source: GPUTexture,
    destinationId: LayerId,
    displayToLinearPipeline: GPURenderPipeline
  ) {
    return this.runtime.rasterDocumentOperations.flattenRenderedImage(
      source,
      destinationId,
      displayToLinearPipeline
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

  rasterizeLayer(
    document: ImageDocument,
    sourceId: LayerId,
    destinationId: LayerId,
    encodeAdjustment?: EncodeAdjustment
  ) {
    return this.runtime.rasterDocumentOperations.rasterizeLayer(
      document,
      sourceId,
      destinationId,
      encodeAdjustment
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

  prepareRasterPaintSurface(layer: RasterLayer) {
    return this.runtime.transformRasterizer.materializeForPixelEditing(layer);
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

  captureAllPixelEdit(layerId: LayerId, channel: PaintChannel = 'pixels') {
    return this.runtime.pixelEditHistory.captureAll(layerId, channel);
  }

  finishPixelEdit(): ReversiblePixelEdit | null {
    return this.runtime.pixelEditHistory.finish();
  }

  cancelPixelEdit() {
    return this.runtime.pixelEditHistory.cancel();
  }

  beginTransform(
    layer: RasterLayer,
    useSelection: boolean,
    bakeLayer = false,
    sourceTransform?: AffineMatrix
  ) {
    return this.runtime.transformRasterizer.begin(
      layer,
      useSelection,
      bakeLayer,
      sourceTransform
    );
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
    const layer = this.document ? findDocumentLayer(this.document, layerId) : null;
    if (!layer || (channel === 'pixels' && layer.type !== 'raster')
      || (channel === 'mask' && !layer.mask)) return false;
    const transform = channel === 'mask'
      ? layer.mask?.transform ?? identityAffineMatrix()
      : buildSceneTransformIndex(this.document!).get(layerId)?.localToDocument ?? layer.transform;
    return this.runtime.rasterPaint.invertColors(layerId, channel, transform);
  }

  bakeSelectionIntoLayerMask(layerId: LayerId) {
    this.assertCommittedSelectionAccess();
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

  applyLayerMaskToPixels(document: ImageDocument, layerId: LayerId) {
    const layer = findDocumentLayer(document, layerId);
    const transform = buildSceneTransformIndex(document).get(layerId)?.localToDocument;
    if (layer?.type !== 'raster' || !layer.mask || !transform) return false;
    return this.runtime.layerMaskPixels.apply(layerId, transform, layer.mask);
  }


  selectionMaskSource(layerId: LayerId) {
    return this.maskTextureFor(layerId);
  }

  async createLayerTransparencySelectionSource(
    document: ImageDocument,
    layer: RasterLayer | Extract<LayerNode, { type: 'text' | 'vector' }>
  ) {
    if (layer.type === 'text') await this.waitForTextSource(layer.id);
    const encoder = this.device.createCommandEncoder({
      label: 'LightTable load layer transparency as selection'
    });
    // The RGB thumbnail represents intrinsic layer pixels. Isolate them in
    // document space so tight rasters, offsets and transforms are honored,
    // while visibility, opacity, masks, effects and local grading do not
    // silently alter the Photoshop-compatible transparency selection.
    const isolatedLayer: typeof layer = {
      ...layer,
      visible: true,
      opacity: 1,
      fillOpacity: 1,
      blendMode: 'normal',
      clipping: false,
      mask: null,
      styleStack: { ...layer.styleStack, enabled: false },
      ...(layer.type === 'raster' ? {
        adjustmentStack: null,
        attachedAdjustments: []
      } : {})
    };
    const source = this.encodeComposite(encoder, {
      ...document,
      layers: [isolatedLayer],
      activeLayerId: layer.id
    });
    this.device.queue.submit([encoder.finish()]);
    return source;
  }


  beginSelectionPaintPreview(baseline: SelectionMaskSnapshot) {
    const committedLease = this.runtime.selectionTextures.beginPreviewMutation();
    if (!committedLease || this.selectionPaintPreview) {
      committedLease?.release();
      return null;
    }
    let stage: SelectionProjectionStage | null = null;
    try {
      stage = this.runtime.createSelectionProjectionStage();
      stage.textures.ensureTargets();
      if (!stage.restore(baseline)) {
        throw new Error('The selection paint baseline could not be staged.');
      }
    } catch (reason) {
      let cleanupFailure: unknown = null;
      try {
        stage?.dispose();
      } catch (cleanupReason) {
        cleanupFailure = cleanupReason;
      } finally {
        committedLease.release();
      }
      if (cleanupFailure) {
        throw new AggregateError(
          [reason, cleanupFailure],
          'The selection paint preview failed and its stage cleanup did not complete.',
        );
      }
      throw reason;
    }
    if (!stage) {
      committedLease.release();
      throw new Error('The selection paint preview stage was not created.');
    }
    const record: SelectionPaintPreviewRecord = {
      stage,
      releaseCommittedLease: committedLease.release,
      retired: false,
    };
    this.selectionPaintPreview = record;
    const isCurrent = () => !record.retired && this.selectionPaintPreview === record;
    const release = () => this.releaseSelectionPaintPreview(record);
    return {
      paintSelectionDabs: (
        dabs: BrushDab[], hardness: number, opacity: number, mode: 'add' | 'subtract'
      ) => isCurrent() && stage.paint({
        dabs,
        hardness,
        opacity,
        mode,
        provenance: {
          mode,
          shape: {
            kind: 'rectangle',
            points: [{ x: 0, y: 0 }, { x: baseline.width, y: baseline.height }],
          },
          source: { kind: 'selection-paint', dabs, hardness, opacity },
        },
      }),
      restoreSelectionSnapshot: (snapshot: SelectionMaskSnapshot) => (
        isCurrent() && stage.restore(snapshot)
      ),
      captureSelectionSnapshot: () => isCurrent()
        ? stage.capture()
        : Promise.reject(new Error('The selection paint preview was retired.')),
      measureSelectionBounds: () => isCurrent() ? stage.measure() : Promise.resolve(null),
      release,
    };
  }

  private releaseSelectionPaintPreview(record = this.selectionPaintPreview): void {
    if (!record || record.retired) return;
    record.retired = true;
    if (this.selectionPaintPreview === record) this.selectionPaintPreview = null;
    try {
      record.stage.dispose();
    } finally {
      record.releaseCommittedLease();
    }
  }


  createMagicWandSourceForActiveLayer(document: ImageDocument, layerId: LayerId) {
    const layer = findDocumentLayer(document, layerId);
    if (!layer) return null;
    const encoder = this.device.createCommandEncoder({
      label: 'LightTable isolate active layer for Magic Wand'
    });
    const source = this.encodeComposite(encoder, {
      ...document,
      layers: [layer],
      activeLayerId: layer.id
    });
    this.device.queue.submit([encoder.finish()]);
    return source;
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

  async exportDisplayRegion(displayTexture: GPUTexture, bounds: Rect, maxEdge: number,
    encoding: Rgba8ImageEncoding = { format: 'png' }) {
    return this.runtime.selectionClipboard.exportDisplayRegion(displayTexture, bounds, maxEdge, encoding);
  }

  async exportSelectionMask() {
    return this.runtime.selectionClipboard.exportSelectionMask();
  }

  async pasteClipboardImage(
    layerId: LayerId,
    blob: Blob,
    requestedPosition: { x: number; y: number } | null,
    channel: PaintChannel = 'pixels'
  ) {
    return this.runtime.selectionClipboard.pasteExternalImage(
      layerId, blob, requestedPosition, channel
    );
  }

  async measureSelectedLayerContent(layer: RasterLayer): Promise<SelectionCoverageBounds | null> {
    this.assertCommittedSelectionAccess();
    return this.runtime.selectionContentAnalyzer.measure(layer, true);
  }

  async measureSelectionBounds(): Promise<SelectionCoverageBounds | null> {
    this.assertCommittedSelectionAccess();
    return this.runtime.selectionContentAnalyzer.measureSelection();
  }

  async measureLayerContent(layer: RasterLayer): Promise<SelectionCoverageBounds | null> {
    return this.runtime.selectionContentAnalyzer.measure(layer, false);
  }

  async measureLayerMaskContent(layer: LayerNode): Promise<SelectionCoverageBounds | null> {
    return this.runtime.selectionContentAnalyzer.measureMask(layer);
  }

  pasteSelectionClipboard(layerId: LayerId) {
    return this.runtime.selectionClipboard.pasteInternal(layerId);
  }

  hasSelectionClipboard() {
    return this.runtime.selectionClipboard.hasInternalClipboard();
  }

  async captureSelectionSnapshot() {
    this.assertCommittedSelectionAccess();
    return this.runtime.selectionRasterizer.captureSnapshot();
  }

  restoreSelectionSnapshot(snapshot: SelectionMaskSnapshot) {
    this.assertCommittedSelectionAccess();
    return this.runtime.selectionRasterizer.restoreSnapshot(snapshot);
  }

  prepareSelectionShapeProjection(
    ...parameters: Parameters<LayerDocumentRendererRuntime['selectionShapeProjection']['prepare']>
  ) {
    return this.runtime.selectionShapeProjection.prepare(...parameters);
  }

  prepareSelectionSnapshotProjection(
    ...parameters: Parameters<LayerDocumentRendererRuntime['selectionShapeProjection']['prepareSnapshot']>
  ) {
    return this.runtime.selectionShapeProjection.prepareSnapshot(...parameters);
  }

  prepareSelectionTranslationProjection(
    ...parameters: Parameters<LayerDocumentRendererRuntime['selectionShapeProjection']['prepareTranslation']>
  ) {
    return this.runtime.selectionShapeProjection.prepareTranslation(...parameters);
  }

  prepareSelectionPaintProjection(
    ...parameters: Parameters<LayerDocumentRendererRuntime['selectionShapeProjection']['preparePaint']>
  ) {
    return this.runtime.selectionShapeProjection.preparePaint(...parameters);
  }

  prepareSelectionMagicWandProjection(
    ...parameters: Parameters<LayerDocumentRendererRuntime['selectionShapeProjection']['prepareMagicWand']>
  ) {
    return this.runtime.selectionShapeProjection.prepareMagicWand(...parameters);
  }

  prepareSelectionOperationProjection(
    document: Parameters<LayerDocumentRendererRuntime['selectionShapeProjection']['prepareOperation']>[0],
    baseline: Parameters<LayerDocumentRendererRuntime['selectionShapeProjection']['prepareOperation']>[1],
    intent: Parameters<LayerDocumentRendererRuntime['selectionShapeProjection']['prepareOperation']>[2],
    source: Parameters<LayerDocumentRendererRuntime['selectionShapeProjection']['prepareOperation']>[3],
    transactionId: Parameters<LayerDocumentRendererRuntime['selectionShapeProjection']['prepareOperation']>[4],
    signal: Parameters<LayerDocumentRendererRuntime['selectionShapeProjection']['prepareOperation']>[5],
  ) {
    return this.runtime.selectionShapeProjection.prepareOperation(
      document, baseline, intent, source, transactionId, signal,
    );
  }

  destroyImageResources() {
    this.releaseSelectionPaintPreview();
    this.runtime.imageResources.destroy();
  }

  destroy() {
    this.destroyImageResources();
    this.runtime.textLayerCoordinator.dispose();
    this.runtime.rasterPaint.destroy();
    this.runtime.selectionShapeProjection.dispose();
    this.runtime.selectionRasterizer.destroy();
    this.runtime.renderResources.destroyPending();
  }
}
