import type { BasicAdjustments, LightTableImageMetadata } from '../types';
import { buildCurveLut, CURVE_LUT_SIZE } from '../curves';
import { DocumentEffectRuntime } from '../effects/DocumentEffectRuntime';
import { LayerEffectRenderer } from '../effects/LayerEffectRenderer';
import type { DepthAnalysisResult } from '../analysis/depth/types';
import {
  layerIsLocked,
  type AdjustmentLayer,
  type ImageDocument,
  type LayerId,
  type LayerNode,
  type Rect,
  type RasterLayer
} from '../editor/document/documentTypes';
import { findDocumentLayer, findRasterLayer, walkLayerTree } from '../editor/document/layerTree';
import { layerStyleStackIsActive } from '../editor/styles/layerStyleDefaults';
import type { BrushDab } from '../editor/tools/brush/strokeBuilder';
import type { PaintChannel } from '../editor/session/editorSession';
import type { SelectionMode, SelectionOperation, SelectionShape } from '../editor/selection/selectionTypes';
import type { AffineMatrix } from '../editor/tools/transform/transformTypes';
import type { DocumentAssetBlob } from '../editor/persistence/layeredDocumentFormat';
import { LayerDocumentRenderer } from '../editor/rendering/LayerDocumentRenderer';
import type { ReversiblePixelEdit } from '../editor/history/ReversiblePixelEdit';
import { FeatureAlignmentService } from '../editor/autoAlign/FeatureAlignmentService';
import type {
  TranslationAlignmentOptions,
  TranslationAlignmentResult
} from '../editor/autoAlign/alignmentTypes';
import type {
  DocumentRendererCallbacks,
  DocumentRendererScopeCanvases,
  LightTableLoadImageOptions,
  ReferenceDifferenceMetrics
} from '../application/rendering/rendererTypes';
import { RenderInvalidationScheduler } from '../application/rendering/renderInvalidationScheduler';
import { RenderDirtyState } from '../application/rendering/renderDirtyState';
import { RenderTelemetry } from '../application/rendering/renderTelemetry';
import {
  resolveViewportRenderState,
  viewportRenderStatesEqual,
  type ViewportRenderState
} from '../application/rendering/viewportRenderState';
import { alignedTargetTransform } from '../editor/autoAlign/alignmentMath';
import { calculateOutputTransformSettings } from '../outputTransform';
import {
  adjustmentStackHasOwner,
  type AdjustmentStack
} from '../processing/adjustmentStack';
import { DocumentAdjustmentState } from '../processing/documentAdjustmentState';
import type { WebGpuScopeOptions } from './WebGpuScopeEngine';
import {
  requestSharedWebGpuDevice,
  subscribeSharedWebGpuDeviceLost
} from './sharedWebGpuDevice';
import { ADJUSTMENT_UNIFORM_FLOATS, buildAdjustmentUniform } from './adjustmentUniform';
import { getCorePipelineBundle } from './corePipelineLibrary';
import { encodeRgba8Png, readRgba8Texture } from './gpuReadback';
import { DocumentImageGpuResources } from './documentImageGpuResources';
import { AdjustmentLayerGpuResources } from './adjustmentLayerGpuResources';
import { AdjustmentLayerRenderer } from './adjustmentLayerRenderer';
import { LayerProcessingRenderer } from './layerProcessingRenderer';
import { ReferenceDifferenceMeasurer } from './referenceDifferenceMeasurer';
import { estimateDocumentGpuBytes } from './documentGpuMemoryEstimate';
import { DocumentSourceGpuLoader } from './documentSourceGpuLoader';
import { DocumentScopeRuntime } from './documentScopeRuntime';
import { DocumentHistogramRuntime } from './documentHistogramRuntime';
import {
  documentRenderRevisionsEqual,
  resolveDocumentRenderRevision,
  type DocumentRenderRevision
} from '../application/rendering/documentRenderRevision';

interface ViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class WebGpuEngine {
  private readonly canvas: HTMLCanvasElement;
  private readonly device: GPUDevice;
  private readonly context: GPUCanvasContext;
  private readonly canvasFormat: GPUTextureFormat;
  private readonly callbacks: DocumentRendererCallbacks;
  private readonly scopeRuntime: DocumentScopeRuntime;
  private histogramRuntime: DocumentHistogramRuntime | null = null;
  private sourceLoader: DocumentSourceGpuLoader | null = null;
  private documentRenderer: LayerDocumentRenderer | null = null;
  private readonly adjustmentLayerResources: AdjustmentLayerGpuResources;
  private readonly adjustmentLayerRenderer: AdjustmentLayerRenderer;
  private translationAlignmentService: FeatureAlignmentService | null = null;
  private imageDocument: ImageDocument | null = null;
  private documentRenderRevision: DocumentRenderRevision | null = null;
  /**
   * Last document-only composite. Global Grade and Lens Fx consume this
   * texture without rebuilding unchanged layers, masks, transforms or styles.
   * Ownership remains with the document renderer/raster runtime.
   */
  private documentCompositeTexture: GPUTexture | null = null;
  private sourceGeometryTexture: GPUTexture | null = null;
  private linearSpatialTexture: GPUTexture | null = null;
  private displayPostTexture: GPUTexture | null = null;
  private lastOutputSettings: Float32Array | null = null;
  private selectionQueue: Promise<void> = Promise.resolve();
  private readonly renderScheduler: RenderInvalidationScheduler;
  private readonly renderDirty = new RenderDirtyState();
  private readonly renderTelemetry = new RenderTelemetry();
  private readonly imageResources = new DocumentImageGpuResources();
  private readonly adjustmentState = new DocumentAdjustmentState();

  private constructor(
    canvas: HTMLCanvasElement,
    device: GPUDevice,
    context: GPUCanvasContext,
    canvasFormat: GPUTextureFormat,
    callbacks: DocumentRendererCallbacks
  ) {
    this.canvas = canvas;
    this.device = device;
    this.context = context;
    this.canvasFormat = canvasFormat;
    this.callbacks = callbacks;
    this.adjustmentLayerResources = new AdjustmentLayerGpuResources(device);
    this.adjustmentLayerRenderer = new AdjustmentLayerRenderer(
      device,
      this.adjustmentLayerResources
    );
    this.renderScheduler = new RenderInvalidationScheduler(() => this.renderNow());
    this.scopeRuntime = new DocumentScopeRuntime(
      device,
      callbacks.onScopeError,
      () => this.requestRender()
    );
    this.deviceErrorListener = ((event: GPUUncapturedErrorEvent) => {
      if (!this.destroyed) {
        this.callbacks.onDeviceLost?.(`LightTable WebGPU runtime error: ${event.error.message}`);
      }
    }) as EventListener;
    this.deviceLostListener = (info) => {
      if (!this.destroyed) {
        this.callbacks.onDeviceLost?.(`WebGPU device lost: ${info.message || info.reason}`);
      }
    };
    this.device.addEventListener('uncapturederror', this.deviceErrorListener);
    this.unsubscribeDeviceLost = subscribeSharedWebGpuDeviceLost(this.deviceLostListener);
  }

  private curveTexture: GPUTexture | null = null;
  private adjustmentBuffer: GPUBuffer | null = null;
  private outputSettingsBuffer: GPUBuffer | null = null;
  private viewBuffer: GPUBuffer | null = null;
  private blurHorizontalBuffer: GPUBuffer | null = null;
  private blurVerticalBuffer: GPUBuffer | null = null;
  private sampler: GPUSampler | null = null;
  private basicPipeline: GPURenderPipeline | null = null;
  private downsamplePipeline: GPURenderPipeline | null = null;
  private blurPipeline: GPURenderPipeline | null = null;
  private creativePipeline: GPURenderPipeline | null = null;
  private outputPipeline: GPURenderPipeline | null = null;
  private effectRuntime: DocumentEffectRuntime | null = null;
  private layerEffectRenderer: LayerEffectRenderer | null = null;
  private layerProcessingRenderer: LayerProcessingRenderer | null = null;
  private displayResolvePipeline: GPURenderPipeline | null = null;
  private blitPipeline: GPURenderPipeline | null = null;
  private differencePipeline: GPURenderPipeline | null = null;
  private differenceMetricsPipeline: GPUComputePipeline | null = null;
  private metadata: LightTableImageMetadata | null = null;
  private before = false;
  private difference = false;
  private lensBlurDepthVisualization = false;
  private firstFramePending = false;
  private layerStyleInitialization: Promise<void> | null = null;
  private layerStyleInitializationFailed = false;
  private readonly deviceErrorListener: EventListener;
  private readonly deviceLostListener: (info: GPUDeviceLostInfo) => void;
  private readonly unsubscribeDeviceLost: () => void;
  private destroyed = false;
  private active = true;
  private paintInteractionActive = false;
  private lastReportedGpuBytes = -1;
  private viewportRenderState: ViewportRenderState | null = null;

  static async create(
    canvas: HTMLCanvasElement,
    callbacks: DocumentRendererCallbacks = {},
    scopeCanvases?: DocumentRendererScopeCanvases
  ) {
    // The adapter/device is independent from a particular editor canvas.
    // Reusing it removes a sizeable repeated startup cost when reopening the tool.
    const device = await requestSharedWebGpuDevice();
    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('The browser could not create a WebGPU canvas context.');
    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
      device,
      format: canvasFormat,
      alphaMode: 'premultiplied',
      colorSpace: 'srgb'
    });
    const engine = new WebGpuEngine(canvas, device, context, canvasFormat, callbacks);
    device.pushErrorScope('validation');
    engine.createStaticResources();
    const validationError = await device.popErrorScope();
    if (validationError) {
      const layerStyleErrors = await engine.documentRenderer?.layerStyleShaderErrors() ?? [];
      engine.destroy();
      const details = layerStyleErrors.length
        ? `\nLayer Style shader:\n${layerStyleErrors.join('\n')}`
        : '';
      throw new Error(
        `LightTable WebGPU pipeline validation failed: ${validationError.message}${details}`
      );
    }
    if (scopeCanvases) await engine.initializeScopes(scopeCanvases);
    return engine;
  }

  /**
   * Scopes are intentionally initialized outside the critical first-image path.
   * Their shader compilation and storage buffers are useful, but not required
   * to put the image on screen.
   */
  async initializeScopes(scopeCanvases: DocumentRendererScopeCanvases) {
    await this.scopeRuntime.initialize(scopeCanvases);
  }

  get imageMetadata() {
    return this.metadata;
  }

  /**
   * Controls presentation residency for a mounted document.
   *
   * Suspension preserves textures and editor state, but prevents background
   * documents from submitting animation-frame renders. Explicit operations
   * such as export may still flush synchronously.
   */
  setActive(active: boolean) {
    if (this.destroyed || active === this.active) return;
    this.active = active;
    this.renderScheduler.setPaused(!active);
    if (active) {
      this.scopeRuntime.resize();
      this.requestRender();
    }
  }

  private createStaticResources() {
    this.sampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge'
    });
    this.adjustmentBuffer = this.device.createBuffer({
      size: ADJUSTMENT_UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.outputSettingsBuffer = this.device.createBuffer({
      label: 'LightTable output transform settings',
      size: 8 * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.curveTexture = this.device.createTexture({
      label: 'LightTable custom curve LUT',
      size: [CURVE_LUT_SIZE, 1],
      format: 'rgba32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
    this.writeCurveLut();
    this.viewBuffer = this.device.createBuffer({
      size: 8 * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.blurHorizontalBuffer = this.createBlurUniformBuffer(1, 0);
    this.blurVerticalBuffer = this.createBlurUniformBuffer(0, 1);

    const pipelines = getCorePipelineBundle(this.device, this.canvasFormat);
    this.basicPipeline = pipelines.basic;
    this.downsamplePipeline = pipelines.downsample;
    this.blurPipeline = pipelines.blur;
    this.creativePipeline = pipelines.creative;
    this.outputPipeline = pipelines.output;
    this.sourceLoader = new DocumentSourceGpuLoader(
      this.device,
      pipelines.precisionSourceResolve
    );
    const effectCallbacks = {
      requestRender: () => this.requestRender(),
      reportError: (featureId: string, message: string) => this.callbacks.onFeatureError?.(featureId, message)
    };
    this.documentRenderer = new LayerDocumentRenderer(this.device, this.sampler);
    this.effectRuntime = DocumentEffectRuntime.create(
      this.device,
      this.sampler,
      pipelines.vertexModule,
      this.adjustmentState.current,
      effectCallbacks
    );
    this.layerEffectRenderer = new LayerEffectRenderer(
      this.device,
      this.sampler,
      pipelines.vertexModule,
      effectCallbacks
    );
    this.layerProcessingRenderer = new LayerProcessingRenderer(
      this.adjustmentLayerRenderer,
      this.layerEffectRenderer
    );
    this.displayResolvePipeline = pipelines.displayResolve;
    this.blitPipeline = pipelines.blit;
    this.differencePipeline = pipelines.difference;
    this.differenceMetricsPipeline = pipelines.differenceMetrics;
    this.histogramRuntime = new DocumentHistogramRuntime(
      this.device,
      pipelines.histogram,
      this.callbacks.onHistogram,
      () => this.requestRender()
    );
  }

  private createBlurUniformBuffer(x: number, y: number) {
    const buffer = this.device.createBuffer({
      size: 4 * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.device.queue.writeBuffer(buffer, 0, new Float32Array([x, y, 0, 0]));
    return buffer;
  }

  async loadImage(blob: Blob, name: string, options: LightTableLoadImageOptions = {}) {
    if (!this.sourceLoader) throw new Error('LightTable source loading is unavailable.');
    const loaded = await this.sourceLoader.load(blob, name, options);
    if (this.destroyed) {
      loaded.texture.destroy();
      throw new Error('LightTable was closed while the image was loading.');
    }
    this.destroyImageResources();
    this.metadata = loaded.metadata;
    this.imageResources.sourceTexture = loaded.texture;
    this.createImageResources(loaded.metadata.width, loaded.metadata.height);
    this.writeAdjustments();
    this.writeOutputSettings();
    this.renderDirty.invalidate('source');
    this.firstFramePending = true;
    this.requestRender();
    return loaded.metadata;
  }

  setDocument(document: ImageDocument) {
    if (!this.imageResources.sourceTexture || !this.documentRenderer) throw new Error('Load an image before creating its LightTable document.');
    const firstDocument = !this.imageDocument || this.imageDocument.id !== document.id;
    const nextRenderRevision = resolveDocumentRenderRevision(document);
    this.imageDocument = document;
    // Always retain the latest editor-only state, but only cross the GPU
    // boundary when immutable document content actually changed.
    if (documentRenderRevisionsEqual(this.documentRenderRevision, nextRenderRevision)) return;
    this.documentRenderRevision = nextRenderRevision;
    if (firstDocument) this.documentRenderer.initialize(document, this.imageResources.sourceTexture);
    else this.documentRenderer.syncDocument(document);
    this.initializeLayerStylesIfNeeded(document);
    this.adjustmentLayerResources.syncDocument(document);
    // The first layered document changes the shared shader input domain from
    // an encoded source image to a linear layer composite. Later document
    // revisions do not change this uniform contract.
    if (firstDocument) this.writeAdjustments();
    this.markDocumentDirty();
  }

  private initializeLayerStylesIfNeeded(document: ImageDocument) {
    if (
      this.layerStyleInitialization ||
      this.layerStyleInitializationFailed ||
      !this.documentRenderer
    ) return;
    const hasActiveStyle = (nodes: readonly LayerNode[]): boolean =>
      nodes.some((node) => (
        layerStyleStackIsActive(node.styleStack)
        || (node.type === 'group' && hasActiveStyle(node.children))
      ));
    if (!hasActiveStyle(document.layers)) return;

    const renderer = this.documentRenderer;
    const initialization = renderer.initializeLayerStylePipeline();
    this.layerStyleInitialization = initialization;
    void initialization.then(
      () => {
        if (this.destroyed) return;
        this.markDocumentDirty();
        this.requestRender();
      },
      async (reason) => {
        this.layerStyleInitializationFailed = true;
        if (this.destroyed) return;
        const layerStyleErrors = await renderer.layerStyleShaderErrors();
        const details = layerStyleErrors.length
          ? `\nLayer Style shader:\n${layerStyleErrors.join('\n')}`
          : '';
        const pipelineMessage = reason instanceof Error ? reason.message : String(reason);
        this.callbacks.onDeviceLost?.(
          `LightTable Layer Style pipeline creation failed: ${pipelineMessage}${details}`
        );
      }
    );
  }

  beginBrushStroke(layer: LayerNode, channel: PaintChannel) {
    this.documentRenderer?.beginStroke(layer, channel);
  }

  /**
   * Keeps direct paint feedback responsive without silently lowering the
   * committed result. Optional analysis and expensive effects enter preview
   * quality for the gesture; releasing it schedules one final-quality pass.
   */
  setPaintInteractionActive(active: boolean) {
    if (this.paintInteractionActive === active) return;
    this.paintInteractionActive = active;
    this.histogramRuntime?.setInteractionActive(active);
    this.scopeRuntime.setInteractionActive(active);
    const effectQualityChanged = this.effectRuntime?.setInteractionActive(active) ?? false;
    const layerStyleQualityChanged = this.documentRenderer?.setLayerStyleInteractionActive(active) ?? false;
    if (!active) {
      if (layerStyleQualityChanged) {
        this.renderDirty.invalidate('document');
      } else if (effectQualityChanged) {
        this.renderDirty.invalidateCorrectionFrom('linear-spatial');
        this.renderDirty.invalidate('histogram');
      }
      this.scopeRuntime.markImageDirty();
      this.requestRender();
    }
  }

  beginLayerPixelEdit(layerId: LayerId, channel: PaintChannel = 'pixels') {
    this.documentRenderer?.beginPixelEdit(layerId, channel);
  }

  finishPixelEdit(): ReversiblePixelEdit | null {
    return this.documentRenderer?.finishPixelEdit() ?? null;
  }

  pruneLayerRuntimes(keepLayerIds: ReadonlySet<LayerId>) {
    this.documentRenderer?.pruneDetachedRuntimes(keepLayerIds);
  }

  cancelPixelEdit() {
    this.documentRenderer?.cancelPixelEdit();
  }

  beginLayerTransform(layer: RasterLayer, useSelection: boolean) {
    this.documentRenderer?.beginTransform(layer, useSelection);
    this.markDocumentDirty();
  }

  updateLayerTransform(matrix: AffineMatrix) {
    const changed = this.documentRenderer?.updateTransform(matrix) ?? false;
    if (changed) this.markDocumentDirty();
    return changed;
  }

  commitLayerTransform() {
    const edit = this.documentRenderer?.commitTransform() ?? null;
    if (edit) this.markDocumentDirty();
    return edit;
  }

  cancelLayerTransform() {
    const changed = this.documentRenderer?.cancelTransform() ?? false;
    if (changed) this.markDocumentDirty();
    return changed;
  }

  async alignLayersTranslation(
    referenceLayerId: LayerId,
    targetLayerId: LayerId,
    options: Partial<TranslationAlignmentOptions> = {},
    signal?: AbortSignal
  ): Promise<TranslationAlignmentResult> {
    const document = this.imageDocument;
    const renderer = this.documentRenderer;
    if (!document || !renderer || !this.sampler) throw new Error('LightTable Auto Align is not initialized.');
    const service = this.translationAlignmentService ??= new FeatureAlignmentService(this.device, this.sampler);
    if (referenceLayerId === targetLayerId) throw new Error('Choose two different layers for Auto Align.');
    const reference = findRasterLayer(document, referenceLayerId);
    const target = findRasterLayer(document, targetLayerId);
    if (!reference || !target) throw new Error('An Auto Align layer is no longer available.');
    if (!reference.visible || !target.visible) throw new Error('Auto Align requires two visible layers.');
    if (layerIsLocked(target, 'position')) throw new Error('The Auto Align target layer is locked.');
    const referenceContract = renderer.resolveRasterRenderContract(reference);
    const targetContract = renderer.resolveRasterRenderContract(target);
    if (!referenceContract || !targetContract) throw new Error('Auto Align source pixels are unavailable.');
    return service.align(referenceContract, targetContract, options, signal);
  }

  /**
   * Shows an Auto Align result through the compositor only. It does not mutate
   * the document, layer pixels, persistence state, or undo history.
   */
  previewTranslationAlignment(result: TranslationAlignmentResult) {
    const document = this.imageDocument;
    const renderer = this.documentRenderer;
    if (!document || !renderer) return false;
    const target = findRasterLayer(document, result.targetLayerId);
    if (!target || layerIsLocked(target, 'position')) return false;
    const changed = renderer.setGeometryPreview(
      target,
      alignedTargetTransform(target.transform, result)
    );
    if (changed) this.markDocumentDirty();
    return changed;
  }

  clearTranslationAlignmentPreview(targetLayerId?: LayerId) {
    const renderer = this.documentRenderer;
    if (!renderer) return false;
    const changed = targetLayerId
      ? (() => {
          const layer = this.imageDocument ? findRasterLayer(this.imageDocument, targetLayerId) : null;
          return layer ? renderer.setGeometryPreview(layer, null) : false;
        })()
      : renderer.clearGeometryPreviews();
    if (changed) this.markDocumentDirty();
    return changed;
  }

  paintBrushDabs(
    layerId: LayerId,
    channel: PaintChannel,
    dabs: BrushDab[],
    color: [number, number, number],
    hardness: number,
    opacity: number,
    flow: number,
    erase = false,
    sourceToDocument?: AffineMatrix
  ) {
    const layer = this.imageDocument
      ? findDocumentLayer(this.imageDocument, layerId)
      : null;
    this.documentRenderer?.paintDabs(
      layerId,
      channel,
      dabs,
      color,
      hardness,
      opacity,
      flow,
      erase,
      sourceToDocument ?? (channel === 'mask' && layer ? layer.transform : undefined)
    );
    this.markDocumentDirty();
  }

  fillLayerColor(
    layerId: LayerId,
    channel: PaintChannel,
    color: [number, number, number],
    preserveTransparency: boolean
  ) {
    const layer = this.imageDocument
      ? findDocumentLayer(this.imageDocument, layerId)
      : null;
    const changed = this.documentRenderer?.fillLayerColor(
      layerId,
      channel,
      color,
      preserveTransparency,
      channel === 'mask' && layer ? layer.transform : undefined
    ) ?? false;
    if (changed) this.markDocumentDirty();
    return changed;
  }

  invertLayerColors(layerId: LayerId, channel: PaintChannel = 'pixels') {
    const changed = this.documentRenderer?.invertLayerColors(layerId, channel) ?? false;
    if (changed) this.markDocumentDirty();
    return changed;
  }

  private async setSelectionNow(shape: SelectionShape, mode: SelectionMode) {
    this.device.pushErrorScope('validation');
    const changed = this.documentRenderer?.setSelection(shape, mode) ?? false;
    const validationError = await this.device.popErrorScope();
    if (validationError) {
      this.callbacks.onDeviceLost?.(`LightTable selection validation failed: ${validationError.message}`);
      return false;
    }
    return changed;
  }

  setSelection(shape: SelectionShape, mode: SelectionMode) {
    const task = this.selectionQueue.then(() => this.setSelectionNow(shape, mode));
    this.selectionQueue = task.then(() => undefined, () => undefined);
    return task;
  }

  clearSelection() {
    return this.replaceSelection([]);
  }

  replaceSelection(operations: SelectionOperation[]) {
    const task = this.selectionQueue.then(async () => {
      this.documentRenderer?.clearSelection();
      for (const operation of operations) {
        if (operation.mode === 'feather') {
          if (!this.documentRenderer?.featherSelection(operation.amount ?? 0)) return false;
        } else if (!await this.setSelectionNow(operation.shape, operation.mode)) {
          return false;
        }
      }
      return true;
    });
    this.selectionQueue = task.then(() => undefined, () => undefined);
    return task;
  }

  copySelectedLayerContent(document: ImageDocument, layerId: LayerId) {
    return this.documentRenderer?.copySelectedLayerContent(document, layerId) ?? false;
  }

  async exportSelectionClipboard(bounds: Rect) {
    if (!this.documentRenderer) {
      throw new Error('The LightTable layer renderer is unavailable.');
    }
    await this.device.queue.onSubmittedWorkDone();
    return this.documentRenderer.exportSelectionClipboard(bounds);
  }

  async exportMergedSelection(bounds: Rect) {
    if (!this.metadata || !this.imageResources.finalTexture || !this.documentRenderer) {
      throw new Error('No processed image is available for Copy Merged.');
    }
    this.settleInteractiveRenderQuality();
    this.renderScheduler.flush();
    await this.device.queue.onSubmittedWorkDone();
    return this.documentRenderer.exportDisplaySelection(this.imageResources.finalTexture, bounds);
  }

  async pasteClipboardImage(
    layerId: LayerId,
    blob: Blob,
    position: { x: number; y: number } | null
  ) {
    const changed = await this.documentRenderer?.pasteClipboardImage(
      layerId,
      blob,
      position
    ) ?? false;
    if (changed) this.markDocumentDirty();
    return changed;
  }

  pasteSelectionClipboard(layerId: LayerId) {
    const changed = this.documentRenderer?.pasteSelectionClipboard(layerId) ?? false;
    if (changed) this.markDocumentDirty();
    return changed;
  }

  hasSelectionClipboard() {
    return this.documentRenderer?.hasSelectionClipboard() ?? false;
  }

  async measureSelectedLayerContent(layer: RasterLayer) {
    await this.selectionQueue;
    return this.documentRenderer?.measureSelectedLayerContent(layer) ?? null;
  }

  async measureLayerContent(layer: RasterLayer) {
    return this.documentRenderer?.measureLayerContent(layer) ?? null;
  }

  exportLayerAssets(document: ImageDocument) {
    if (!this.documentRenderer) throw new Error('The LightTable layer renderer is unavailable.');
    return this.documentRenderer.exportDocumentAssets(document);
  }

  exportLayerThumbnail(layerId: LayerId, maskChannel = false) {
    if (!this.documentRenderer) {
      throw new Error('The LightTable layer renderer is unavailable.');
    }
    return this.documentRenderer.exportLayerThumbnail(layerId, maskChannel);
  }

  async loadLayerAssets(assets: DocumentAssetBlob[]) {
    if (!this.documentRenderer) throw new Error('The LightTable layer renderer is unavailable.');
    await this.documentRenderer.loadDocumentAssets(assets);
    this.markDocumentDirty();
  }

  duplicateLayerPixels(sourceId: LayerId, destinationId: LayerId) {
    this.documentRenderer?.duplicateLayer(sourceId, destinationId);
    this.markDocumentDirty();
  }

  mergeLayerDown(document: ImageDocument, topId: LayerId, bottomId: LayerId) {
    const changed = this.documentRenderer?.mergeLayerDown(
      document,
      topId,
      bottomId,
      (encoder, source, layer) =>
        this.encodeLayerProcessing(encoder, source, layer)
    ) ?? false;
    if (changed) this.markDocumentDirty();
    return changed;
  }

  mergeLayers(document: ImageDocument, layerIds: readonly LayerId[], destinationId: LayerId) {
    const changed = this.documentRenderer?.mergeLayers(
      document,
      layerIds,
      destinationId,
      (encoder, source, layer) =>
        this.encodeLayerProcessing(encoder, source, layer)
    ) ?? false;
    if (changed) this.markDocumentDirty();
    return changed;
  }

  flattenGroup(document: ImageDocument, groupId: LayerId, destinationId: LayerId) {
    const changed = this.documentRenderer?.flattenGroup(
      document,
      groupId,
      destinationId,
      (encoder, source, layer) =>
        this.encodeLayerProcessing(encoder, source, layer)
    ) ?? false;
    if (changed) this.markDocumentDirty();
    return changed;
  }

  flattenImage(document: ImageDocument, destinationId: LayerId) {
    const changed = this.documentRenderer?.flattenImage(
      document,
      destinationId,
      (encoder, source, layer) =>
        this.encodeLayerProcessing(encoder, source, layer)
    ) ?? false;
    if (changed) this.markDocumentDirty();
    return changed;
  }

  applyPixelHistory(edit: ReversiblePixelEdit, direction: 'undo' | 'redo') {
    const changed = direction === 'undo' ? edit.undo() : edit.redo();
    if (changed) this.markDocumentDirty();
    return changed;
  }

  private markDocumentDirty() {
    this.renderDirty.invalidate('document');
    this.scopeRuntime.markImageDirty();
    this.requestRender();
  }

  /**
   * Canonical per-layer processing order used by both interactive compositing
   * and every command that bakes pixels. Keeping this in one place prevents a
   * merge/flatten operation from silently dropping Lens Fx or changing order.
   */
  private encodeLayerProcessing(
    encoder: GPUCommandEncoder,
    source: GPUTexture,
    layer: AdjustmentLayer | RasterLayer
  ): GPUTexture {
    return this.layerProcessingRenderer?.encode(encoder, source, layer) ?? source;
  }

  private createImageResources(width: number, height: number) {
    if (!this.imageResources.sourceTexture || !this.sampler || !this.adjustmentBuffer || !this.viewBuffer ||
      !this.blurHorizontalBuffer || !this.blurVerticalBuffer || !this.curveTexture ||
      !this.basicPipeline || !this.downsamplePipeline || !this.blurPipeline || !this.creativePipeline ||
      !this.outputPipeline || !this.outputSettingsBuffer || !this.effectRuntime || !this.displayResolvePipeline ||
      !this.blitPipeline || !this.differencePipeline || !this.histogramRuntime || !this.metadata) return;

    const downsampleWidth = Math.max(1, Math.ceil(width / 4));
    const downsampleHeight = Math.max(1, Math.ceil(height / 4));
    this.imageResources.correctedTexture = this.device.createTexture({
      label: 'LightTable linear working image',
      size: [width, height],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    });
    this.imageResources.downsampleTexture = this.device.createTexture({
      label: 'LightTable reduced luminance',
      size: [downsampleWidth, downsampleHeight],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    });
    this.imageResources.blurTexture = this.device.createTexture({
      label: 'LightTable blurred luminance',
      size: [downsampleWidth, downsampleHeight],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    });
    this.imageResources.creativeTexture = this.device.createTexture({
      label: 'LightTable linear creative grade',
      size: [width, height],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    });
    this.imageResources.displayTexture = this.device.createTexture({
      label: 'LightTable display-mapped image before display effects',
      size: [width, height],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    });
    this.effectRuntime.resize(width, height);
    this.layerEffectRenderer?.resize(width, height);
    this.imageResources.finalTexture = this.device.createTexture({
      label: 'LightTable display-encoded result',
      size: [width, height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST
    });
    this.adjustmentLayerResources.configure({
      sampler: this.sampler,
      creativePipeline: this.creativePipeline,
      correctedTexture: this.imageResources.correctedTexture,
      downsampleTexture: this.imageResources.downsampleTexture
    });

    this.imageResources.downsampleBindGroup = this.device.createBindGroup({
      layout: this.downsamplePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.imageResources.correctedTexture.createView() },
        { binding: 1, resource: this.sampler }
      ]
    });
    this.imageResources.blurHorizontalBindGroup = this.device.createBindGroup({
      layout: this.blurPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.imageResources.downsampleTexture.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: this.blurHorizontalBuffer } }
      ]
    });
    this.imageResources.blurVerticalBindGroup = this.device.createBindGroup({
      layout: this.blurPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.imageResources.blurTexture.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: this.blurVerticalBuffer } }
      ]
    });
    this.imageResources.creativeBindGroup = this.device.createBindGroup({
      layout: this.creativePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.imageResources.correctedTexture.createView() },
        { binding: 1, resource: this.imageResources.downsampleTexture.createView() },
        { binding: 2, resource: this.sampler },
        { binding: 3, resource: { buffer: this.adjustmentBuffer } },
        { binding: 4, resource: this.curveTexture.createView() }
      ]
    });
    this.adjustmentLayerRenderer.configure({
      sampler: this.sampler,
      basicPipeline: this.basicPipeline,
      downsamplePipeline: this.downsamplePipeline,
      blurPipeline: this.blurPipeline,
      creativePipeline: this.creativePipeline,
      correctedTexture: this.imageResources.correctedTexture,
      downsampleTexture: this.imageResources.downsampleTexture,
      blurTexture: this.imageResources.blurTexture,
      creativeTexture: this.imageResources.creativeTexture,
      downsampleBindGroup: this.imageResources.downsampleBindGroup,
      blurHorizontalBindGroup: this.imageResources.blurHorizontalBindGroup,
      blurVerticalBindGroup: this.imageResources.blurVerticalBindGroup,
      width,
      height
    });
    this.imageResources.blitOriginalBindGroup = this.device.createBindGroup({
      layout: this.blitPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.imageResources.sourceTexture.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: this.viewBuffer } }
      ]
    });
    this.imageResources.blitCorrectedBindGroup = this.device.createBindGroup({
      layout: this.blitPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.imageResources.finalTexture.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: this.viewBuffer } }
      ]
    });
    this.imageResources.differenceBindGroup = this.device.createBindGroup({
      layout: this.differencePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.imageResources.sourceTexture.createView() },
        { binding: 1, resource: this.imageResources.finalTexture.createView() },
        { binding: 2, resource: this.sampler },
        { binding: 3, resource: { buffer: this.viewBuffer } }
      ]
    });
    this.histogramRuntime.configure(this.imageResources.sourceTexture, this.imageResources.finalTexture, this.metadata);
    if (this.metadata) this.scopeRuntime.setTextures(
      this.imageResources.sourceTexture,
      this.imageResources.finalTexture,
      this.metadata
    );
  }

  setAdjustments(adjustments: BasicAdjustments) {
    if (!this.adjustmentState.replaceBasic(adjustments)) return;
    this.applyMaterializedAdjustments();
  }

  setAdjustmentStack(stack: AdjustmentStack) {
    if (!this.adjustmentState.replaceStack(stack)) return;
    this.applyMaterializedAdjustments();
  }

  getAdjustmentStack() {
    return this.adjustmentState.stackSnapshot();
  }

  private applyMaterializedAdjustments() {
    const effectChange = this.effectRuntime?.setAdjustmentStack(
      this.adjustmentState.stackSnapshot()
    );
    this.writeCurveLut();
    this.writeAdjustments();
    const outputChanged = this.writeOutputSettings();
    if (effectChange?.earliestStage) {
      this.renderDirty.invalidateCorrectionFrom(effectChange.earliestStage);
    } else {
      // Non-effect grade settings currently enter the final output contract.
      // Keep that conservative boundary until every grade module has its own
      // registered executor.
      this.renderDirty.invalidateCorrectionFrom('output');
    }
    if (outputChanged) this.renderDirty.invalidateCorrectionFrom('output');
    this.renderDirty.invalidate('histogram');
    this.scopeRuntime.markImageDirty();
    this.requestRender();
  }

  setDepthMap(depth: DepthAnalysisResult) {
    if (!this.effectRuntime?.setDepthMap(depth)) return;
    this.writeOutputSettings();
    this.renderDirty.invalidateCorrectionFrom('linear-spatial');
    this.renderDirty.invalidate('histogram');
    this.scopeRuntime.markImageDirty();
    this.requestRender();
  }

  setBefore(before: boolean) {
    if (this.before === before) return;
    this.before = before;
    if (before) this.difference = false;
    this.renderDirty.invalidate('view-mode');
    this.scopeRuntime.setBefore(before);
    this.requestRender();
  }

  setDifference(difference: boolean) {
    if (this.difference === difference) return;
    this.difference = difference;
    if (difference) this.before = false;
    this.renderDirty.invalidate('viewport');
    // Scopes remain tied to the reconstructed image. A difference image is a
    // diagnostic view, not a grade source and must not silently replace them.
    this.scopeRuntime.setBefore(false);
    this.requestRender();
  }

  async measureReferenceDifference(threshold = 2 / 255): Promise<ReferenceDifferenceMetrics> {
    if (!this.metadata || !this.imageResources.sourceTexture || !this.imageResources.finalTexture || !this.differenceMetricsPipeline) {
      throw new Error('No Photoshop reference and LightTable reconstruction are available for comparison.');
    }
    await this.layerStyleInitialization;
    this.settleInteractiveRenderQuality();
    this.renderScheduler.flush();
    await this.device.queue.onSubmittedWorkDone();

    return new ReferenceDifferenceMeasurer(
      this.device,
      this.differenceMetricsPipeline
    ).measure({
      sourceTexture: this.imageResources.sourceTexture,
      reconstructedTexture: this.imageResources.finalTexture,
      width: this.metadata.width,
      height: this.metadata.height,
      threshold
    });
  }

  setScopeOptions(histogramVisible: boolean, options: WebGpuScopeOptions) {
    const histogramBecameVisible = this.histogramRuntime?.setVisible(histogramVisible) ?? false;
    if (histogramBecameVisible) this.renderDirty.invalidate('histogram');
    const scopesChanged = this.scopeRuntime.setOptions(options);
    if (histogramBecameVisible || scopesChanged) this.requestRender();
  }

  setScopeInteractionActive(active: boolean) {
    const histogramChanged = this.histogramRuntime?.setInteractionActive(active) ?? false;
    const scopesChanged = this.scopeRuntime.setInteractionActive(active);
    if (histogramChanged || scopesChanged) this.requestRender();
  }

  setLensBlurInteractionActive(active: boolean) {
    if (!this.effectRuntime?.setInteractionActive(active)) return;
    this.renderDirty.invalidateCorrectionFrom('linear-spatial');
    this.renderDirty.invalidate('histogram');
    this.scopeRuntime.markImageDirty();
    this.requestRender();
  }

  setLayerStyleInteractionActive(active: boolean) {
    if (this.documentRenderer?.setLayerStyleInteractionActive(active)) {
      this.markDocumentDirty();
    }
  }

  setLensBlurDepthVisualization(visualize: boolean) {
    if (this.lensBlurDepthVisualization === visualize) return;
    this.lensBlurDepthVisualization = visualize;
    this.effectRuntime?.setDepthVisualization(visualize);
    this.writeOutputSettings();
    this.renderDirty.invalidateCorrectionFrom('linear-spatial');
    this.requestRender();
  }

  resizeScopes() {
    if (!this.scopeRuntime.resize()) return;
    this.requestRender();
  }

  resizeViewport(cssWidth: number, cssHeight: number, dpr: number, rect: ViewportRect) {
    const nextState = resolveViewportRenderState(cssWidth, cssHeight, dpr, rect);
    if (viewportRenderStatesEqual(this.viewportRenderState, nextState)) return;
    this.viewportRenderState = nextState;
    const { pixelWidth, pixelHeight } = nextState;
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
    if (this.viewBuffer) {
      this.device.queue.writeBuffer(this.viewBuffer, 0, nextState.uniforms);
    }
    this.renderDirty.invalidate('viewport');
    this.requestRender();
  }

  private writeAdjustments() {
    if (!this.adjustmentBuffer) return;
    this.device.queue.writeBuffer(this.adjustmentBuffer, 0, buildAdjustmentUniform(
      this.adjustmentState.current,
      this.metadata?.width ?? 1,
      this.metadata?.height ?? 1,
      Boolean(this.imageDocument)
    ));
  }

  private writeCurveLut() {
    if (!this.curveTexture) return;
    this.device.queue.writeTexture(
      { texture: this.curveTexture },
      buildCurveLut(this.adjustmentState.current.curves),
      { bytesPerRow: CURVE_LUT_SIZE * 4 * Float32Array.BYTES_PER_ELEMENT },
      { width: CURVE_LUT_SIZE, height: 1 }
    );
  }

  private writeOutputSettings(): boolean {
    if (!this.outputSettingsBuffer) return false;
    const settings = calculateOutputTransformSettings(this.adjustmentState.current);
    const visualizingDepth = Boolean(
      this.adjustmentState.current.effects.lensBlur.enabled &&
      this.lensBlurDepthVisualization &&
      this.effectRuntime?.hasDepth
    );
    const next = new Float32Array([
      visualizingDepth ? 0 : settings.whites,
      visualizingDepth ? 0 : settings.shoulderStrength,
      visualizingDepth ? 0 : (settings.active ? 1 : 0),
      visualizingDepth ? 0 : settings.vignette,
      this.metadata?.width ?? 1,
      this.metadata?.height ?? 1,
      0,
      0
    ]);
    if (
      this.lastOutputSettings
      && this.lastOutputSettings.length === next.length
      && next.every((value, index) => value === this.lastOutputSettings?.[index])
    ) return false;
    this.lastOutputSettings = next;
    this.device.queue.writeBuffer(this.outputSettingsBuffer, 0, next);
    return true;
  }

  private requestRender() {
    if (!this.destroyed) this.renderScheduler.invalidate();
  }

  /**
   * Leaves preview-quality paths only when an interaction actually changed
   * their output. Export and reference measurement can therefore reuse the
   * committed frame instead of forcing the complete effect graph.
   */
  private settleInteractiveRenderQuality() {
    const effectQualityChanged = this.effectRuntime?.setInteractionActive(false) ?? false;
    const layerStyleQualityChanged = this.documentRenderer?.setLayerStyleInteractionActive(false) ?? false;
    if (layerStyleQualityChanged) {
      this.renderDirty.invalidate('document');
    } else if (effectQualityChanged) {
      this.renderDirty.invalidateCorrectionFrom('linear-spatial');
      this.renderDirty.invalidate('histogram');
    }
    if (effectQualityChanged || layerStyleQualityChanged) {
      this.scopeRuntime.markImageDirty();
      this.requestRender();
    }
  }

  private estimatedGpuTextureBytes() {
    if (!this.metadata) return 0;
    return estimateDocumentGpuBytes({
      width: this.metadata.width,
      height: this.metadata.height,
      sourceBitDepth: this.metadata.sourceBitDepth ?? 8,
      source: Boolean(this.imageResources.sourceTexture),
      corrected: Boolean(this.imageResources.correctedTexture),
      downsample: Boolean(this.imageResources.downsampleTexture),
      blur: Boolean(this.imageResources.blurTexture),
      creative: Boolean(this.imageResources.creativeTexture),
      display: Boolean(this.imageResources.displayTexture),
      final: Boolean(this.imageResources.finalTexture),
      curveLutBytes: this.curveTexture ? CURVE_LUT_SIZE * 16 : 0,
      adjustmentLayerBytes: this.adjustmentLayerResources.estimatedBytes(),
      layerDocumentBytes: this.documentRenderer?.estimatedTextureBytes() ?? 0,
      effectBytes: this.effectRuntime?.estimatedTextureBytes() ?? 0
    });
  }

  private reportGpuMemoryEstimate() {
    const bytes = this.estimatedGpuTextureBytes();
    if (bytes === this.lastReportedGpuBytes) return;
    this.lastReportedGpuBytes = bytes;
    this.callbacks.onGpuMemoryEstimate?.(bytes);
  }

  private renderNow() {
    if (this.destroyed || !this.metadata || !this.imageResources.correctedTexture || !this.imageResources.downsampleTexture ||
      !this.imageResources.blurTexture || !this.imageResources.creativeTexture || !this.imageResources.displayTexture ||
      !this.imageResources.finalTexture || !this.basicPipeline || !this.downsamplePipeline ||
      !this.blurPipeline || !this.creativePipeline || !this.outputPipeline || !this.outputSettingsBuffer ||
      !this.imageResources.sourceTexture || !this.sampler || !this.adjustmentBuffer || !this.curveTexture ||
      !this.effectRuntime || !this.documentRenderer || !this.imageDocument ||
      !this.displayResolvePipeline || !this.blitPipeline || !this.differencePipeline ||
      !this.imageResources.downsampleBindGroup || !this.imageResources.blurHorizontalBindGroup || !this.imageResources.blurVerticalBindGroup ||
      !this.imageResources.creativeBindGroup ||
      !this.imageResources.blitOriginalBindGroup || !this.imageResources.blitCorrectedBindGroup ||
      !this.imageResources.differenceBindGroup) return;

    this.renderTelemetry.recordRenderCall();

    // Observer completion (notably histogram readback) may request a retry in
    // case the image changed while a read was pending. If no renderer stage or
    // scope actually remained dirty, stop before allocating/submitting an
    // empty GPU command buffer. This boundary also prevents presentation-only
    // React updates from accidentally waking the heavy frame graph.
    if (!this.renderDirty.hasPendingFrameWork && !this.scopeRuntime.hasPendingWork()) {
      this.renderTelemetry.recordNoWorkSkip();
      return;
    }

    // Capture the first validation failure from the frame. Without a scope the
    // useful error is commonly followed by—and visually replaced with—the
    // generic "Invalid CommandBuffer due to a previous error" message.
    this.device.pushErrorScope('validation');
    const encoder = this.device.createCommandEncoder({ label: 'LightTable render' });
    let renderedCorrection = false;
    if (this.renderDirty.correctionRequired) {
      this.renderTelemetry.recordCorrectionFrame();
      // Missing cached handles invalidate their complete downstream chain.
      // This prevents a freshly rebuilt source from being paired with a stale
      // spatial or display result after image-resource lifecycle changes.
      if (!this.sourceGeometryTexture) {
        this.renderDirty.invalidateCorrectionFrom('source-geometry');
      } else if (!this.linearSpatialTexture) {
        this.renderDirty.invalidateCorrectionFrom('linear-spatial');
      } else if (!this.displayPostTexture) {
        this.renderDirty.invalidateCorrectionFrom('display-post');
      }
      if (this.renderDirty.documentCompositeRequired || !this.documentCompositeTexture) {
        this.documentCompositeTexture = this.renderTelemetry.measure(
          'document-composite',
          () => this.documentRenderer!.encodeComposite(
            encoder,
            this.imageDocument!,
            (layerEncoder, source, layer) =>
              this.encodeLayerProcessing(layerEncoder, source, layer)
          )
        );
        this.renderDirty.markDocumentCompositeRendered();
      }
      const documentTexture = this.documentCompositeTexture;
      this.layerEffectRenderer?.syncOwners(new Set(
        walkLayerTree(this.imageDocument.layers)
          .filter(({ node }) =>
            (node.type === 'raster' || node.type === 'adjustment')
            && adjustmentStackHasOwner(node.adjustmentStack, 'lens-fx')
          )
          .map(({ node }) => node.id)
      ));
      if (
        this.renderDirty.correctionStageRequired('source-geometry')
        || !this.sourceGeometryTexture
      ) {
        this.sourceGeometryTexture = this.renderTelemetry.measure(
          'source-geometry',
          () => this.effectRuntime!.encodeSourceGeometry(encoder, documentTexture)
        );
      }
      const sourceGeometryTexture = this.sourceGeometryTexture;
      const visualizingDepth = Boolean(
        this.adjustmentState.current.effects.lensBlur.enabled &&
        this.lensBlurDepthVisualization &&
        this.effectRuntime.hasDepth
      );
      if (
        this.renderDirty.correctionStageRequired('linear-spatial')
        || !this.linearSpatialTexture
      ) {
        this.linearSpatialTexture = this.renderTelemetry.measure(
          'linear-spatial',
          () => this.effectRuntime!.encodeLinearSpatial(
            encoder,
            sourceGeometryTexture,
            { visualizeDepth: visualizingDepth }
          )
        );
      }
      const linearEffectTexture = this.linearSpatialTexture;
      if (this.renderDirty.correctionStageRequired('output')) {
        this.renderTelemetry.measure('output', () => {
          const outputBindGroup = this.device.createBindGroup({
            layout: this.outputPipeline!.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: linearEffectTexture.createView() },
              { binding: 1, resource: { buffer: this.outputSettingsBuffer! } }
            ]
          });
          this.drawFullscreenPass(
            encoder,
            this.outputPipeline!,
            outputBindGroup,
            this.imageResources.displayTexture!.createView()
          );
        });
      }
      if (
        this.renderDirty.correctionStageRequired('display-post')
        || !this.displayPostTexture
      ) {
        this.displayPostTexture = this.renderTelemetry.measure(
          'display-post',
          () => this.effectRuntime!.encodeDisplayPost(
            encoder,
            this.imageResources.displayTexture!,
            visualizingDepth
          )
        );
      }
      const displayEffectTexture = this.displayPostTexture;
      this.renderTelemetry.measure('display-resolve', () => {
        const displayResolveBindGroup = this.device.createBindGroup({
          layout: this.displayResolvePipeline!.getBindGroupLayout(0),
          entries: [{ binding: 0, resource: displayEffectTexture.createView() }]
        });
        this.drawFullscreenPass(
          encoder,
          this.displayResolvePipeline!,
          displayResolveBindGroup,
          this.imageResources.finalTexture!.createView()
        );
      });
      this.renderDirty.markCorrectionRendered();
      renderedCorrection = true;
    }
    if (this.renderDirty.viewportRequired) {
      const canvasView = this.context.getCurrentTexture().createView();
      if (this.difference) {
        this.drawFullscreenPass(
          encoder,
          this.differencePipeline,
          this.imageResources.differenceBindGroup,
          canvasView
        );
      } else {
        this.drawFullscreenPass(
          encoder,
          this.blitPipeline,
          this.before
            ? this.imageResources.blitOriginalBindGroup
            : this.imageResources.blitCorrectedBindGroup,
          canvasView
        );
      }
      this.renderDirty.markViewportRendered();
    }

    const histogramReadBuffer = this.histogramRuntime?.encode(encoder, {
      before: this.before,
      required: this.renderDirty.histogramRequired
    }) ?? null;
    if (histogramReadBuffer) this.renderDirty.markHistogramScheduled();
    this.scopeRuntime.encode(encoder);
    this.device.queue.submit([encoder.finish()]);
    this.renderTelemetry.recordSubmittedFrame();
    void this.device.popErrorScope().then((validationError) => {
      if (!this.destroyed && validationError) {
        this.callbacks.onDeviceLost?.(
          `LightTable render validation failed: ${validationError.message}`
        );
      }
    });
    this.reportGpuMemoryEstimate();
    if (renderedCorrection && this.firstFramePending) {
      this.firstFramePending = false;
      void this.device.queue.onSubmittedWorkDone().then(() => {
        if (!this.destroyed) this.callbacks.onFirstFrame?.();
      });
    }
    this.documentRenderer?.releaseSubmittedResources();
    if (histogramReadBuffer) void this.histogramRuntime?.read(histogramReadBuffer);
  }

  renderTelemetrySnapshot() {
    return this.renderTelemetry.snapshot();
  }

  resetRenderTelemetry() {
    this.renderTelemetry.reset();
  }

  private drawFullscreenPass(
    encoder: GPUCommandEncoder,
    pipeline: GPURenderPipeline,
    bindGroup: GPUBindGroup,
    target: GPUTextureView
  ) {
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: target,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store'
      }]
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
  }

  async exportPng() {
    if (!this.metadata || !this.imageResources.finalTexture) throw new Error('No processed image is available for export.');
    this.settleInteractiveRenderQuality();
    this.renderScheduler.flush();
    await this.device.queue.onSubmittedWorkDone();

    const pixels = await readRgba8Texture(
      this.device,
      this.imageResources.finalTexture,
      this.metadata.width,
      this.metadata.height,
      'LightTable PNG export readback'
    );
    return encodeRgba8Png(pixels, this.metadata.width, this.metadata.height);
  }

  destroy() {
    this.destroyed = true;
    this.paintInteractionActive = false;
    this.device.removeEventListener('uncapturederror', this.deviceErrorListener);
    this.unsubscribeDeviceLost();
    this.sourceLoader?.destroy();
    this.sourceLoader = null;
    this.renderScheduler.dispose();
    this.destroyImageResources();
    this.scopeRuntime.destroy();
    this.adjustmentBuffer?.destroy();
    this.outputSettingsBuffer?.destroy();
    this.viewBuffer?.destroy();
    this.histogramRuntime?.destroy();
    this.histogramRuntime = null;
    this.blurHorizontalBuffer?.destroy();
    this.blurVerticalBuffer?.destroy();
    this.curveTexture?.destroy();
    this.effectRuntime?.destroy();
    this.effectRuntime = null;
    this.layerEffectRenderer?.destroy();
    this.layerEffectRenderer = null;
    this.layerProcessingRenderer = null;
    this.documentRenderer?.destroy();
    this.documentRenderer = null;
  }

  private destroyImageResources() {
    this.documentRenderer?.destroyImageResources();
    this.adjustmentLayerRenderer.reset();
    this.adjustmentLayerResources.reset();
    this.imageDocument = null;
    this.documentRenderRevision = null;
    this.documentCompositeTexture = null;
    this.sourceGeometryTexture = null;
    this.linearSpatialTexture = null;
    this.displayPostTexture = null;
    this.scopeRuntime.clearTextures();
    this.histogramRuntime?.clear();
    this.effectRuntime?.destroyImageResources();
    this.layerEffectRenderer?.destroyImageResources();
    this.imageResources.reset();
  }
}
