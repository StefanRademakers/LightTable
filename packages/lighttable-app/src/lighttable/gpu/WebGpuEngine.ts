import type { GradientPaintInstance } from '@lighttable/paint-core';
import type { BasicAdjustments, LightTableImageMetadata } from '../types';
import { CURVE_LUT_SIZE } from '../curves';
import { DocumentEffectRuntime } from '../effects/DocumentEffectRuntime';
import {
  LayerEffectRenderer,
  layerNeedsEffectRuntime
} from '../effects/LayerEffectRenderer';
import type { DepthAnalysisResult } from '../analysis/depth/types';
import {
  layerIsLocked,
  type AdjustmentLayer,
  type ImageDocument,
  type LayerId,
  type LayerNode,
  type Rect,
  type RasterLayer,
  type TextLayer
} from '../editor/document/documentTypes';
import { findDocumentLayer, findRasterLayer, walkLayerTree } from '../editor/document/layerTree';
import { layerStyleStackIsActive } from '../editor/styles/layerStyleDefaults';
import {
  DEFAULT_BRUSH_TIP,
  type BrushDab,
  type BrushEngine,
  type BrushTipDefinition
} from '../editor/tools/brush/strokeBuilder';
import type { PaintChannel } from '../editor/session/editorSession';
import type { BlendMode } from '../editor/document/blendModes';
import type {
  CompositeColorChannel,
  SelectionCombineMode,
  SelectionMode,
  SelectionOperation,
  SelectionPoint,
  SelectionShape
} from '../editor/selection/selectionTypes';
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
import { interactionFrameIntervalMs, RenderInvalidationScheduler } from '../application/rendering/renderInvalidationScheduler';
import { SelectionAntsAnimator } from '../application/rendering/SelectionAntsAnimator';
import {
  RenderDirtyState,
  resolveAdjustmentInvalidationStage
} from '../application/rendering/renderDirtyState';
import { RenderTelemetry } from '../application/rendering/renderTelemetry';
import {
  recordTextInteractionTrace,
  type TextInteractionTraceIdentity
} from '../application/text/textInteractionPerformanceTrace';
import { ViewportPresentationController } from '../application/rendering/viewportPresentationController';
import type { ViewportRenderRect } from '../application/rendering/viewportRenderState';
import { alignedTargetTransform } from '../editor/autoAlign/alignmentMath';
import { calculateOutputTransformSettings } from '../outputTransform';
import type { AdjustmentStack } from '../processing/adjustmentStack';
import { DocumentAdjustmentState } from '../processing/documentAdjustmentState';
import type { WebGpuScopeOptions } from './WebGpuScopeEngine';
import {
  requestSharedWebGpuDevice,
  subscribeSharedWebGpuDeviceLost
} from './sharedWebGpuDevice';
import { getCorePipelineBundle } from './corePipelineLibrary';
import { DocumentCoreGpuResources } from './documentCoreGpuResources';
import { encodeRgba8Png, readRgba8Texture, readRgba8TexturePixel } from './gpuReadback';
import { DocumentImageGpuResources } from './documentImageGpuResources';
import { AdjustmentLayerGpuResources } from './adjustmentLayerGpuResources';
import { AdjustmentLayerRenderer } from './adjustmentLayerRenderer';
import { LayerProcessingRenderer } from './layerProcessingRenderer';
import { ReferenceDifferenceMeasurer } from './referenceDifferenceMeasurer';
import { estimateDocumentGpuBytes } from './documentGpuMemoryEstimate';
import { DocumentSourceGpuLoader } from './documentSourceGpuLoader';
import { DocumentScopeRuntime } from './documentScopeRuntime';
import { DocumentHistogramRuntime } from './documentHistogramRuntime';
import { documentRenderStatesEqual } from '../application/rendering/documentRenderState';
import type { WarpDebugView } from '../effects/warp/warpTypes';
import {
  BRUSH_CURSOR_THEME,
  GRADIENT_GIZMO_THEME,
  SELECTION_OUTLINE_THEME,
  VectorEditingOverlayBackend,
  type VectorEditingOverlayTarget
} from '@lighttable/vector-webgpu';
import type { VectorEditingOverlay, VectorSelectionFrame } from '@lighttable/vector-rendering';
import { buildVectorDocumentEditingSceneOverlay } from '../application/vectors/vectorEditingOverlay';
import { vectorLayerLocalPaintBounds } from '../application/vectors/vectorSceneQueries';
import {
  cloneVectorEditorSelection,
  createVectorEditorSelection,
  vectorEditorSelectionsEqual,
  type VectorEditorSelection
} from '../editor/session/editorSession';
import {
  buildBrushCursorEditingOverlay,
  buildSelectionEditingOverlay,
  directSelectionShape
} from '../editor/selection/selectionEditingOverlay';
import { SelectionContourOverlayBackend } from '../editor/rendering/SelectionContourOverlayBackend';
import type { TextFontRuntimePort } from '../text/rendering/TextLayerRenderCoordinator';
import type { TextEditingOverlay } from '@lighttable/text-rendering';
import { TextEditingOverlayBackend } from '@lighttable/text-webgpu';

export interface WebGpuPngExportOptions {
  readonly excludedLayerIds?: readonly LayerId[];
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
  /**
   * Last document-only composite. Global Grade and Lens Fx consume this
   * texture without rebuilding unchanged layers, masks, transforms or styles.
   * Ownership remains with the document renderer/raster runtime.
   */
  private documentCompositeTexture: GPUTexture | null = null;
  private sourceGeometryTexture: GPUTexture | null = null;
  private linearSpatialTexture: GPUTexture | null = null;
  private displayPostTexture: GPUTexture | null = null;
  private selectionQueue: Promise<void> = Promise.resolve();
  private readonly renderScheduler: RenderInvalidationScheduler;
  private readonly selectionAntsAnimator: SelectionAntsAnimator;
  private readonly renderDirty = new RenderDirtyState();
  private readonly renderTelemetry = new RenderTelemetry();
  private pendingTextInteractionTrace: TextInteractionTraceIdentity | null = null;
  private readonly imageResources = new DocumentImageGpuResources();
  private readonly adjustmentState = new DocumentAdjustmentState();
  private readonly viewportPresentation: ViewportPresentationController;
  private coreResources: DocumentCoreGpuResources | null = null;

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
    this.selectionAntsAnimator = new SelectionAntsAnimator({
      invalidateViewport: () => this.renderDirty.invalidate('viewport'),
      requestRender: () => this.requestRender()
    });
    this.viewportPresentation = new ViewportPresentationController(canvas, {
      writeViewport: (uniforms) => this.coreResources?.writeViewport(uniforms),
      invalidateViewport: () => this.renderDirty.invalidate('viewport'),
      requestRender: () => this.requestRender()
    });
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
        this.documentRenderer?.handleDeviceLoss();
        this.callbacks.onDeviceLost?.(`WebGPU device lost: ${info.message || info.reason}`);
      }
    };
    this.device.addEventListener('uncapturederror', this.deviceErrorListener);
    this.unsubscribeDeviceLost = subscribeSharedWebGpuDeviceLost(this.deviceLostListener);
  }

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
  private maskBlitPipeline: GPURenderPipeline | null = null;
  private channelBlitPipeline: GPURenderPipeline | null = null;
  private differencePipeline: GPURenderPipeline | null = null;
  private differenceMetricsPipeline: GPUComputePipeline | null = null;
  private metadata: LightTableImageMetadata | null = null;
  private before = false;
  private difference = false;
  private isolatedMaskLayerId: LayerId | null = null;
  private isolatedMaskTexture: GPUTexture | null = null;
  private isolatedMaskBindGroup: GPUBindGroup | null = null;
  private isolatedMaskNearestBindGroup: GPUBindGroup | null = null;
  private isolatedCompositeChannel: CompositeColorChannel | null = null;
  private lensBlurDepthVisualization = false;
  private warpDebugVisualization: WarpDebugView = 'result';
  private firstFramePending = false;
  private layerStyleInitialization: Promise<void> | null = null;
  private layerStyleInitializationFailed = false;
  private readonly deviceErrorListener: EventListener;
  private readonly deviceLostListener: (info: GPUDeviceLostInfo) => void;
  private readonly unsubscribeDeviceLost: () => void;
  private destroyed = false;
  private active = true;
  private paintInteractionActive = false;
  private warpInteractionActive = false;
  private lastReportedGpuBytes = -1;
  private vectorSelection = createVectorEditorSelection();
  private selectionOverlayOperations: SelectionOperation[] = [];
  private selectionOverlayDraft: SelectionShape | null = null;
  private selectionOverlayVisible = false;
  private zoomOverlayDraft: SelectionShape | null = null;
  private brushCursorOverlay: {
    center: { x: number; y: number };
    diameter: number;
  } | null = null;
  private penRubberBand: { from: { x: number; y: number }; to: { x: number; y: number } } | null = null;
  private transformEditingFrame: VectorSelectionFrame | null = null;
  private vectorEditingOverlayBackend: VectorEditingOverlayBackend | null = null;
  private textEditingOverlayBackend: TextEditingOverlayBackend | null = null;
  private textEditingOverlay: TextEditingOverlay | null = null;
  private textCaretVisible = true;
  private selectionContourOverlayBackend: SelectionContourOverlayBackend | null = null;

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
    this.selectionAntsAnimator.setActive(active);
    this.documentRenderer?.setActive(active);
    if (active) {
      this.scopeRuntime.resize();
      this.requestRender();
    }
  }

  private createStaticResources() {
    const coreResources = new DocumentCoreGpuResources(this.device);
    this.coreResources = coreResources;
    this.syncAdjustmentPayload();
    this.viewportPresentation.syncCurrentState();

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
    this.documentRenderer = new LayerDocumentRenderer(
      this.device,
      coreResources.sampler,
      () => {
        if (!this.destroyed && this.imageDocument) this.markDocumentDirty();
      },
      (snapshot) => this.callbacks.onTextRenderPresentation?.(snapshot),
      (message) => this.callbacks.onFeatureError?.('text-renderer', message)
    );
    this.effectRuntime = DocumentEffectRuntime.create(
      this.device,
      coreResources.sampler,
      pipelines.vertexModule,
      this.adjustmentState.current,
      effectCallbacks
    );
    this.layerEffectRenderer = new LayerEffectRenderer(
      this.device,
      coreResources.sampler,
      pipelines.vertexModule,
      {
        // Layer effects are encoded into the retained document composite.
        // A lazy pipeline becoming ready must invalidate that composite; merely
        // scheduling a frame would keep displaying the clean cached texture.
        requestRender: () => this.markDocumentDirty(),
        reportError: effectCallbacks.reportError
      }
    );
    this.layerProcessingRenderer = new LayerProcessingRenderer(
      this.adjustmentLayerRenderer,
      this.layerEffectRenderer
    );
    this.displayResolvePipeline = pipelines.displayResolve;
    this.blitPipeline = pipelines.blit;
    this.maskBlitPipeline = pipelines.maskBlit;
    this.channelBlitPipeline = pipelines.channelBlit;
    this.differencePipeline = pipelines.difference;
    this.differenceMetricsPipeline = pipelines.differenceMetrics;
    this.histogramRuntime = new DocumentHistogramRuntime(
      this.device,
      pipelines.histogram,
      this.callbacks.onHistogram,
      () => this.requestRender()
    );
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
    const previousDocument = this.imageDocument;
    const firstDocument = !previousDocument || previousDocument.id !== document.id;
    if (firstDocument) this.textEditingOverlay = null;
    this.imageDocument = document;
    const warpDebugOwnerChanged = this.layerEffectRenderer?.setWarpDebugVisualization(
      this.warpDebugVisualization,
      document.activeLayerId
    ) ?? false;
    // Always retain the latest editor-only state, but only cross the GPU
    // boundary when render-bearing immutable document content changed.
    if (documentRenderStatesEqual(previousDocument, document)) {
      if (warpDebugOwnerChanged) this.markDocumentDirty();
      return;
    }
    const traceDocumentSync = (
      globalThis as typeof globalThis & { __LIGHTTABLE_TEXT_INPUT_TRACE__?: boolean }
    ).__LIGHTTABLE_TEXT_INPUT_TRACE__ === true;
    const measure = (stage: string, startedAt: number) => {
      if (!traceDocumentSync) return;
      performance.measure('LightTable text document sync', {
        start: startedAt,
        end: performance.now(),
        detail: Object.freeze({ stage })
      });
    };
    let stageStartedAt = performance.now();
    if (firstDocument) this.documentRenderer.initialize(document, this.imageResources.sourceTexture);
    else this.documentRenderer.syncDocument(document);
    measure('layer-runtimes', stageStartedAt);
    stageStartedAt = performance.now();
    this.initializeLayerStylesIfNeeded(document);
    measure('style-initialization', stageStartedAt);
    stageStartedAt = performance.now();
    this.adjustmentLayerResources.syncDocument(document);
    measure('adjustment-resources', stageStartedAt);
    // The first layered document changes the shared shader input domain from
    // an encoded source image to a linear layer composite. Later document
    // revisions do not change this uniform contract.
    if (firstDocument) this.writeAdjustments();
    stageStartedAt = performance.now();
    this.markDocumentDirty();
    measure('dirty-scheduling', stageStartedAt);
  }

  /**
   * Reconfigures document-sized GPU targets without discarding layer runtimes.
   * Raster sources therefore stay on the GPU and semantic layers remain native.
   */
  resizeDocumentSurface(document: ImageDocument) {
    if (!this.metadata || !this.documentRenderer || !this.imageResources.sourceTexture) {
      throw new Error('Load an image before resizing its document.');
    }
    const dimensionsChanged = document.width !== this.metadata.width
      || document.height !== this.metadata.height;
    if (!dimensionsChanged) {
      this.setDocument(document);
      return;
    }
    this.documentRenderer.resizeSurface(document.width, document.height);
    this.adjustmentLayerRenderer.reset();
    this.adjustmentLayerResources.reset();
    this.documentCompositeTexture = null;
    this.sourceGeometryTexture = null;
    this.linearSpatialTexture = null;
    this.displayPostTexture = null;
    this.scopeRuntime.clearTextures();
    this.histogramRuntime?.clear();
    this.effectRuntime?.destroyImageResources();
    this.layerEffectRenderer?.destroyImageResources();
    this.imageResources.resetDerived();
    this.metadata = { ...this.metadata, width: document.width, height: document.height };
    this.createImageResources(document.width, document.height);
    this.imageDocument = document;
    this.documentRenderer.syncDocument(document);
    this.adjustmentLayerResources.syncDocument(document);
    this.initializeLayerStylesIfNeeded(document);
    this.writeAdjustments();
    this.writeOutputSettings();
    this.markDocumentDirty();
  }

  resizeImagePixels(
    document: ImageDocument,
    plan: import('../editor/document/imageResizeTypes').ResizePlan,
    noiseReduction: number
  ) {
    if (!this.documentRenderer) throw new Error('The document renderer is unavailable.');
    return this.documentRenderer.resizeImagePixels(document, plan, noiseReduction);
  }

  /**
   * Crosses a just-committed automation document into GPU-owned runtimes even
   * when the application reused the same document object during one event
   * turn. Normal React publication remains deduplicated by setDocument().
   */
  synchronizeDocumentForExport(document: ImageDocument) {
    if (!this.documentRenderer || !this.imageResources.sourceTexture) {
      throw new Error('Load an image before exporting its LightTable document.');
    }
    this.imageDocument = document;
    this.documentRenderer.syncDocument(document);
    this.adjustmentLayerResources.syncDocument(document);
    this.markDocumentDirty();
  }

  configureTextFonts(port: TextFontRuntimePort | null) {
    this.documentRenderer?.configureTextFonts(port);
  }

  textEditingLayout(layerId: LayerId) {
    return this.documentRenderer?.textEditingLayout(layerId) ?? null;
  }

  setTextLayerInteraction(layerId: LayerId, active: boolean) {
    return this.documentRenderer?.setTextLayerInteraction(layerId, active) ?? false;
  }

  beginTextInput(layerId: LayerId, startedAt = performance.now()) {
    return this.documentRenderer?.beginTextInput(layerId, startedAt) ?? false;
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

  preparePaintTool() {
    this.documentRenderer?.preparePaintTool();
  }

  prepareMagicWandTool() {
    return this.documentRenderer?.prepareMagicWandTool() ?? Promise.resolve();
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
    this.syncInteractiveRenderCadence();
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
  setWarpInteractionActive(active: boolean) {
    if (this.warpInteractionActive === active) return;
    this.warpInteractionActive = active;
    this.syncInteractiveRenderCadence();
    if (!active) this.requestRender();
  }
  beginLayerPixelEdit(layerId: LayerId, channel: PaintChannel = 'pixels') {
    this.documentRenderer?.beginPixelEdit(layerId, channel);
  }

  finishPixelEdit(): ReversiblePixelEdit | null {
    return this.documentRenderer?.finishPixelEdit() ?? null;
  }

  pruneLayerRuntimes(
    keepRasterLayerIds: ReadonlySet<LayerId>,
    keepMaskLayerIds: ReadonlySet<LayerId>
  ) {
    this.documentRenderer?.pruneDetachedRuntimes(keepRasterLayerIds, keepMaskLayerIds);
  }

  cancelPixelEdit() {
    this.documentRenderer?.cancelPixelEdit();
  }

  beginLayerTransform(layer: RasterLayer, useSelection: boolean) {
    this.documentRenderer?.beginTransform(layer, useSelection);
    this.markDocumentDirty();
  }

  setDuplicateLayerTransform(duplicate: boolean) {
    return this.documentRenderer?.setDuplicateLayerTransform(duplicate) ?? false;
  }

  updateLayerTransform(matrix: AffineMatrix) {
    const changed = this.documentRenderer?.updateTransform(matrix) ?? false;
    if (changed) this.markDocumentDirty();
    return changed;
  }

  updateLayerProjectiveTransform(
    source: import('../editor/tools/transform/transformTypes').TransformQuad,
    destination: import('../editor/tools/transform/transformTypes').TransformQuad
  ) {
    const changed = this.documentRenderer?.updateProjectiveTransform(source, destination) ?? false;
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

  async measureSemanticLayerContent(layer: LayerNode) {
    if (layer.type === 'vector') {
      const bounds = vectorLayerLocalPaintBounds(layer);
      if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;
      return {
        coreBounds: { ...bounds },
        supportBounds: { ...bounds },
        peakCoverage: 1
      };
    }
    if (layer.type !== 'text') return null;
    const realized = this.documentRenderer?.textEditingLayout(layer.id)?.layout;
    const bounds = realized?.paragraphFrame?.bounds ?? realized?.logicalBounds;
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;
    return {
      coreBounds: { ...bounds },
      supportBounds: { ...bounds },
      peakCoverage: 1
    };
  }

  beginSemanticLayerTransform(layer: LayerNode) {
    const renderer = this.documentRenderer;
    if (!renderer || (layer.type !== 'text' && layer.type !== 'vector')) return false;
    const changed = renderer.setGeometryPreview(layer, layer.transform);
    if (changed) this.markDocumentDirty();
    return changed;
  }

  updateSemanticLayerTransform(layer: LayerNode, matrix: AffineMatrix) {
    const renderer = this.documentRenderer;
    if (!renderer || (layer.type !== 'text' && layer.type !== 'vector')) return false;
    const changed = renderer.setGeometryPreview(layer, matrix);
    if (changed) this.markDocumentDirty();
    return changed;
  }

  cancelSemanticLayerTransform(layer: LayerNode) {
    const renderer = this.documentRenderer;
    if (!renderer) return false;
    const changed = renderer.setGeometryPreview(layer, null);
    if (changed) this.markDocumentDirty();
    return changed;
  }

  setSemanticLayerInteraction(layer: LayerNode, active: boolean) {
    return layer.type === 'text'
      ? this.documentRenderer?.setTextLayerInteraction(layer.id, active) ?? false
      : false;
  }

  async alignLayersTranslation(
    referenceLayerId: LayerId,
    targetLayerId: LayerId,
    options: Partial<TranslationAlignmentOptions> = {},
    signal?: AbortSignal
  ): Promise<TranslationAlignmentResult> {
    const document = this.imageDocument;
    const renderer = this.documentRenderer;
    if (!document || !renderer || !this.coreResources) throw new Error('LightTable Auto Align is not initialized.');
    const service = this.translationAlignmentService ??= new FeatureAlignmentService(
      this.device,
      this.coreResources.sampler
    );
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
    sourceToDocument?: AffineMatrix,
    tip: BrushTipDefinition = DEFAULT_BRUSH_TIP,
    engine: BrushEngine = 'paint'
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
      sourceToDocument ?? (channel === 'mask' && layer ? layer.transform : undefined),
      channel === 'pixels' && Boolean(layer?.locks.transparency),
      tip,
      engine
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
      channel === 'pixels' && layer?.type === 'raster'
        ? layer.transform
        : undefined
    ) ?? false;
    if (changed) this.markDocumentDirty();
    return changed;
  }

  fillLayerGradient(
    layerId: LayerId,
    channel: PaintChannel,
    paint: GradientPaintInstance,
    opacity: number,
    blendMode: BlendMode,
    preserveTransparency: boolean
  ) {
    const layer = this.imageDocument
      ? findDocumentLayer(this.imageDocument, layerId)
      : null;
    const changed = this.documentRenderer?.fillLayerGradient(
      layerId,
      channel,
      paint,
      opacity,
      blendMode,
      preserveTransparency,
      channel === 'pixels' && layer?.type === 'raster'
        ? layer.transform
        : layer?.transform
    ) ?? false;
    if (changed) this.markDocumentDirty();
    return changed;
  }

  invertLayerColors(layerId: LayerId, channel: PaintChannel = 'pixels') {
    const changed = this.documentRenderer?.invertLayerColors(layerId, channel) ?? false;
    if (changed) this.markDocumentDirty();
    return changed;
  }

  bakeSelectionIntoLayerMask(layerId: LayerId) {
    const changed = this.documentRenderer?.bakeSelectionIntoLayerMask(layerId) ?? false;
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

  pickTopLayerAtPoint(
    layerIds: readonly LayerId[],
    point: SelectionPoint,
    knownOpaqueLayerIds?: ReadonlySet<LayerId>
  ) {
    if (!this.imageDocument || !this.documentRenderer) return Promise.resolve(null);
    return this.documentRenderer.pickTopLayerAtPoint(
      this.imageDocument, layerIds, point, knownOpaqueLayerIds
    );
  }

  private async applyMagicWandNow(operation: SelectionOperation) {
    const source = operation.source;
    if (source?.kind !== 'magic-wand' || !this.imageDocument || !this.documentRenderer) {
      return false;
    }
    if (
      source.documentRevision !== this.imageDocument.revision
      || !findDocumentLayer(this.imageDocument, source.layerId)
    ) return false;
    // Tool activation normally finishes this work while the pointer travels
    // to the canvas. Awaiting the same isolated promise closes the fast-click
    // race without compiling a second pipeline set or touching document state.
    await this.documentRenderer.prepareMagicWandTool();
    const traceTarget = (
      globalThis as typeof globalThis & {
        __LIGHTTABLE_MAGIC_WAND_TRACE__?: Array<{
          encodeMs: number;
          gpuCompleteMs: number;
          width: number;
          height: number;
          contiguous: boolean;
          sampleAllLayers: boolean;
          mode: SelectionCombineMode;
        }>;
      }
    ).__LIGHTTABLE_MAGIC_WAND_TRACE__;
    const traceStartedAt = traceTarget ? performance.now() : 0;
    this.device.pushErrorScope('validation');
    let changed = false;
    if (source.options.sampleAllLayers) {
      this.settleInteractiveRenderQuality();
      this.renderScheduler.flush();
      await this.device.queue.onSubmittedWorkDone();
      const composite = this.imageResources.finalTexture;
      changed = Boolean(composite) && this.documentRenderer.applyMagicWandToTexture(
        composite!, source.point, source.options, operation.mode as SelectionCombineMode
      );
    } else {
      changed = this.documentRenderer.applyMagicWandToActiveLayer(
        this.imageDocument,
        source.layerId,
        source.point,
        source.options,
        operation.mode as SelectionCombineMode
      );
    }
    const encodedAt = traceTarget ? performance.now() : 0;
    const validationError = await this.device.popErrorScope();
    if (validationError) {
      this.callbacks.onDeviceLost?.(`LightTable Magic Wand validation failed: ${validationError.message}`);
      return false;
    }
    if (traceTarget && changed) {
      await this.device.queue.onSubmittedWorkDone();
      traceTarget.push({
        encodeMs: encodedAt - traceStartedAt,
        gpuCompleteMs: performance.now() - traceStartedAt,
        width: this.imageDocument.width,
        height: this.imageDocument.height,
        contiguous: source.options.contiguous,
        sampleAllLayers: source.options.sampleAllLayers,
        mode: operation.mode as SelectionCombineMode
      });
    }
    return changed;
  }

  applyMagicWand(operation: SelectionOperation) {
    const task = this.selectionQueue.then(() => this.applyMagicWandNow(operation));
    this.selectionQueue = task.then(() => undefined, () => undefined);
    return task;
  }

  transformSelection(matrix: { a: number; b: number; c: number; d: number; tx: number; ty: number }) {
    const task = this.selectionQueue.then(() => (
      this.documentRenderer?.transformSelection(matrix) ?? false
    ));
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
        if (operation.source?.kind === 'layer-mask') {
          const layer = this.imageDocument
            ? findDocumentLayer(this.imageDocument, operation.source.layerId)
            : null;
          if (
            !layer?.mask
            || layer.mask.pixelRevision !== operation.source.pixelRevision
            || !this.documentRenderer?.loadLayerMaskAsSelection(layer.id)
          ) return false;
        } else if (operation.source?.kind === 'layer-transparency') {
          const layer = this.imageDocument
            ? findDocumentLayer(this.imageDocument, operation.source.layerId)
            : null;
          if (
            !this.imageDocument
            || layer?.type !== 'raster'
            || layer.pixelRevision !== operation.source.pixelRevision
            || !this.documentRenderer?.loadRasterLayerTransparencyAsSelection(
              this.imageDocument,
              layer
            )
          ) return false;
        } else if (operation.source?.kind === 'composite-channel') {
          if (
            !this.imageDocument
            || this.imageDocument.revision !== operation.source.documentRevision
            || !this.imageResources.finalTexture
            || !this.documentRenderer
          ) return false;
          // The final reconstructed texture is the canonical source for a
          // Channels-panel selection. Flush pending correction work before
          // reading it so the selection never observes a stale grade frame.
          this.settleInteractiveRenderQuality();
          this.renderScheduler.flush();
          await this.device.queue.onSubmittedWorkDone();
          if (!this.documentRenderer.loadCompositeChannelAsSelection(
            this.imageResources.finalTexture,
            operation.source.channel
          )) return false;
        } else if (operation.source?.kind === 'magic-wand') {
          if (!await this.applyMagicWandNow(operation)) return false;
        } else if (operation.mode === 'feather') {
          if (!this.documentRenderer?.featherSelection(operation.amount ?? 0)) return false;
        } else if (operation.mode === 'transform') {
          if (!operation.transform || !this.documentRenderer?.transformSelection(operation.transform)) {
            return false;
          }
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
    return this.documentRenderer?.copySelectedLayerContent(
      document,
      layerId,
      (encoder, source, layer) => this.encodeLayerProcessing(encoder, source, layer)
    ) ?? false;
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

  exportPsdLayerAssets(document: ImageDocument) {
    if (!this.documentRenderer) throw new Error('The LightTable layer renderer is unavailable.');
    return this.documentRenderer.exportPsdDocumentAssets(document);
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

  prepareRasterDestination(destination: RasterLayer) {
    return this.documentRenderer?.prepareRasterDestination(destination) ?? false;
  }

  commitRasterDestination(layerId: LayerId) {
    this.documentRenderer?.commitRasterDestination(layerId);
  }

  releaseRasterDestination(layerId: LayerId) {
    return this.documentRenderer?.releaseRasterDestination(layerId) ?? false;
  }

  rasterizeText(document: ImageDocument, source: TextLayer, destination: RasterLayer) {
    const changed = this.documentRenderer?.rasterizeText(document, source, destination) ?? false;
    if (changed) this.markDocumentDirty();
    return changed;
  }

  vectorPathsForTextLayer(layerId: LayerId, signal?: AbortSignal) {
    return this.documentRenderer?.vectorPathsForTextLayer(layerId, signal)
      ?? Promise.resolve(null);
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
    if (!this.imageResources.sourceTexture || !this.coreResources ||
      !this.basicPipeline || !this.downsamplePipeline || !this.blurPipeline || !this.creativePipeline ||
      !this.outputPipeline || !this.effectRuntime || !this.displayResolvePipeline ||
      !this.blitPipeline || !this.channelBlitPipeline || !this.differencePipeline ||
      !this.histogramRuntime || !this.metadata) return;
    const coreResources = this.coreResources;

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
      sampler: coreResources.sampler,
      creativePipeline: this.creativePipeline,
      correctedTexture: this.imageResources.correctedTexture,
      downsampleTexture: this.imageResources.downsampleTexture
    });

    this.imageResources.downsampleBindGroup = this.device.createBindGroup({
      layout: this.downsamplePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.imageResources.correctedTexture.createView() },
        { binding: 1, resource: coreResources.sampler }
      ]
    });
    this.imageResources.blurHorizontalBindGroup = this.device.createBindGroup({
      layout: this.blurPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.imageResources.downsampleTexture.createView() },
        { binding: 1, resource: coreResources.sampler },
        { binding: 2, resource: { buffer: coreResources.blurHorizontalBuffer } }
      ]
    });
    this.imageResources.blurVerticalBindGroup = this.device.createBindGroup({
      layout: this.blurPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.imageResources.blurTexture.createView() },
        { binding: 1, resource: coreResources.sampler },
        { binding: 2, resource: { buffer: coreResources.blurVerticalBuffer } }
      ]
    });
    this.imageResources.creativeBindGroup = this.device.createBindGroup({
      layout: this.creativePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.imageResources.correctedTexture.createView() },
        { binding: 1, resource: this.imageResources.downsampleTexture.createView() },
        { binding: 2, resource: coreResources.sampler },
        { binding: 3, resource: { buffer: coreResources.adjustmentBuffer } },
        { binding: 4, resource: coreResources.curveTexture.createView() }
      ]
    });
    this.adjustmentLayerRenderer.configure({
      sampler: coreResources.sampler,
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
        { binding: 1, resource: coreResources.sampler },
        { binding: 2, resource: { buffer: coreResources.viewBuffer } }
      ]
    });
    this.imageResources.blitCorrectedBindGroup = this.device.createBindGroup({
      layout: this.blitPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.imageResources.finalTexture.createView() },
        { binding: 1, resource: coreResources.sampler },
        { binding: 2, resource: { buffer: coreResources.viewBuffer } }
      ]
    });
    this.imageResources.blitOriginalNearestBindGroup = this.device.createBindGroup({
      layout: this.blitPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.imageResources.sourceTexture.createView() },
        { binding: 1, resource: coreResources.nearestSampler },
        { binding: 2, resource: { buffer: coreResources.viewBuffer } }
      ]
    });
    this.imageResources.blitCorrectedNearestBindGroup = this.device.createBindGroup({
      layout: this.blitPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.imageResources.finalTexture.createView() },
        { binding: 1, resource: coreResources.nearestSampler },
        { binding: 2, resource: { buffer: coreResources.viewBuffer } }
      ]
    });
    this.imageResources.channelBindGroup = this.device.createBindGroup({
      layout: this.channelBlitPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.imageResources.finalTexture.createView() },
        { binding: 1, resource: coreResources.sampler },
        { binding: 2, resource: { buffer: coreResources.viewBuffer } },
        { binding: 3, resource: { buffer: coreResources.channelViewBuffer } }
      ]
    });
    this.imageResources.channelNearestBindGroup = this.device.createBindGroup({
      layout: this.channelBlitPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.imageResources.finalTexture.createView() },
        { binding: 1, resource: coreResources.nearestSampler },
        { binding: 2, resource: { buffer: coreResources.viewBuffer } },
        { binding: 3, resource: { buffer: coreResources.channelViewBuffer } }
      ]
    });
    this.imageResources.differenceBindGroup = this.device.createBindGroup({
      layout: this.differencePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.imageResources.sourceTexture.createView() },
        { binding: 1, resource: this.imageResources.finalTexture.createView() },
        { binding: 2, resource: coreResources.sampler },
        { binding: 3, resource: { buffer: coreResources.viewBuffer } }
      ]
    });
    this.imageResources.differenceNearestBindGroup = this.device.createBindGroup({
      layout: this.differencePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.imageResources.sourceTexture.createView() },
        { binding: 1, resource: this.imageResources.finalTexture.createView() },
        { binding: 2, resource: coreResources.nearestSampler },
        { binding: 3, resource: { buffer: coreResources.viewBuffer } }
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
    this.syncInteractiveRenderCadence();
    const payloadChange = this.syncAdjustmentPayload();
    const outputChanged = this.writeOutputSettings();
    const invalidationStage = resolveAdjustmentInvalidationStage({
      effectStage: effectChange?.earliestStage ?? null,
      uniformChanged: payloadChange?.uniformChanged ?? false,
      curveChanged: payloadChange?.curveChanged ?? false,
      outputChanged
    });
    if (!invalidationStage) return;
    this.renderDirty.invalidateCorrectionFrom(invalidationStage);
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

  setMaskIsolation(layerId: LayerId | null) {
    if (this.isolatedMaskLayerId === layerId) return;
    this.isolatedMaskLayerId = layerId;
    if (layerId) this.isolatedCompositeChannel = null;
    this.isolatedMaskTexture = null;
    this.isolatedMaskBindGroup = null;
    this.isolatedMaskNearestBindGroup = null;
    this.renderDirty.invalidate('viewport');
    // Mask isolation is a presentation diagnostic. Scopes deliberately stay
    // attached to the reconstructed document rather than the mask channel.
    this.requestRender();
  }

  setCompositeChannelIsolation(channel: CompositeColorChannel | null) {
    if (this.isolatedCompositeChannel === channel) return;
    this.isolatedCompositeChannel = channel;
    if (channel) {
      this.isolatedMaskLayerId = null;
      this.isolatedMaskTexture = null;
      this.isolatedMaskBindGroup = null;
      this.isolatedMaskNearestBindGroup = null;
    }
    if (this.coreResources) {
      const channelIndex = channel === 'green' ? 1 : channel === 'blue' ? 2 : 0;
      this.device.queue.writeBuffer(
        this.coreResources.channelViewBuffer,
        0,
        new Uint32Array([channelIndex, 0, 0, 0])
      );
    }
    this.renderDirty.invalidate('viewport');
    this.requestRender();
  }

  setVectorEditingSelection(selection: VectorEditorSelection) {
    if (vectorEditorSelectionsEqual(this.vectorSelection, selection)) return;
    this.vectorSelection = cloneVectorEditorSelection(selection);
    this.renderDirty.invalidate('viewport');
    this.requestRender();
  }

  setSelectionEditingOverlay(
    operations: readonly SelectionOperation[],
    draft: SelectionShape | null,
    visible: boolean
  ) {
    this.selectionOverlayOperations = operations.map((operation) => ({
      ...operation,
      shape: {
        ...operation.shape,
        points: operation.shape.points.map((point) => ({ ...point }))
      }
    }));
    this.selectionOverlayDraft = draft ? {
      ...draft,
      points: draft.points.map((point) => ({ ...point }))
    } : null;
    this.selectionOverlayVisible = visible;
    this.selectionAntsAnimator.setSelectionVisible(
      visible && this.selectionOverlayOperations.length > 0
    );
    this.renderDirty.invalidate('viewport');
    this.requestRender();
  }

  setZoomEditingOverlay(draft: SelectionShape | null) {
    const currentKey = this.zoomOverlayDraft
      ? JSON.stringify(this.zoomOverlayDraft.points)
      : '';
    const nextKey = draft ? JSON.stringify(draft.points) : '';
    if (currentKey === nextKey) return;
    this.zoomOverlayDraft = draft ? {
      kind: 'rectangle',
      points: draft.points.map((point) => ({ ...point }))
    } : null;
    this.renderDirty.invalidate('viewport');
    this.requestRender();
  }

  setTextEditingOverlay(
    overlay: TextEditingOverlay | null,
    caretVisible = true,
    trace: TextInteractionTraceIdentity | null = null
  ) {
    if (
      this.textEditingOverlay?.resourceKey === overlay?.resourceKey
      && this.textCaretVisible === caretVisible
    ) return;
    this.textEditingOverlay = overlay;
    this.textCaretVisible = caretVisible;
    if (trace) {
      this.pendingTextInteractionTrace = trace;
      recordTextInteractionTrace(trace, 'overlay-set');
    }
    this.renderDirty.invalidate('viewport');
    this.requestRender();
  }

  setBrushCursorOverlay(cursor: {
    center: { x: number; y: number };
    diameter: number;
  } | null) {
    const current = this.brushCursorOverlay;
    if (
      current === null && cursor === null
      || current !== null && cursor !== null
        && current.center.x === cursor.center.x
        && current.center.y === cursor.center.y
        && current.diameter === cursor.diameter
    ) return;
    this.brushCursorOverlay = cursor ? {
      center: { ...cursor.center },
      diameter: cursor.diameter
    } : null;
    this.renderDirty.invalidate('viewport');
    this.requestRender();
  }

  setPenRubberBandOverlay(band: {
    from: { x: number; y: number };
    to: { x: number; y: number };
  } | null) {
    const current = this.penRubberBand;
    if (current === null && band === null
      || current && band
        && current.from.x === band.from.x && current.from.y === band.from.y
        && current.to.x === band.to.x && current.to.y === band.to.y) return;
    this.penRubberBand = band ? {
      from: { ...band.from },
      to: { ...band.to }
    } : null;
    this.renderDirty.invalidate('viewport');
    this.requestRender();
  }

  async sampleDisplayColor(point: { x: number; y: number }) {
    const texture = this.imageResources.finalTexture;
    const metadata = this.metadata;
    if (!texture || !metadata) throw new Error('The rendered document is unavailable.');
    const x = Math.max(0, Math.min(metadata.width - 1, Math.floor(point.x)));
    const y = Math.max(0, Math.min(metadata.height - 1, Math.floor(point.y)));
    return readRgba8TexturePixel(this.device, texture, x, y, 'LightTable eyedropper sample');
  }

  setTransformEditingFrame(frame: VectorSelectionFrame | null) {
    if (this.transformEditingFrame?.resourceKey === frame?.resourceKey) return;
    this.transformEditingFrame = frame ? {
      ...frame,
      bounds: { ...frame.bounds },
      pivot: { ...frame.pivot },
      edges: frame.edges.map(({ start, end }) => ({
        start: { ...start },
        end: { ...end }
      })),
      handles: frame.handles.map((handle) => ({
        ...handle,
        point: { ...handle.point }
      }))
    } : null;
    this.renderDirty.invalidate('viewport');
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
    const outputChanged = this.effectRuntime?.setInteractionActive(active) ?? false;
    this.syncInteractiveRenderCadence();
    if (!outputChanged) return;
    this.renderDirty.invalidateCorrectionFrom('linear-spatial');
    this.renderDirty.invalidate('histogram');
    this.scopeRuntime.markImageDirty();
    this.requestRender();
  }

  setLayerStyleInteractionActive(active: boolean, layerId?: LayerId) {
    if (this.documentRenderer?.setLayerStyleInteractionActive(active, layerId)) {
      this.markDocumentDirty();
    }
  }

  /** Development-only presentation fixture; it never mutates or bakes into the document. */
  async setDevelopmentTextFixtureEnabled(enabled: boolean) {
    if (!import.meta.env.DEV && enabled) {
      throw new Error('The canvas text fixture is available only in development builds.');
    }
    if (!this.documentRenderer) throw new Error('The document renderer is unavailable.');
    return this.documentRenderer.setDevelopmentTextFixtureEnabled(enabled);
  }

  setLensBlurDepthVisualization(visualize: boolean) {
    if (this.lensBlurDepthVisualization === visualize) return;
    this.lensBlurDepthVisualization = visualize;
    this.effectRuntime?.setDepthVisualization(visualize);
    this.writeOutputSettings();
    this.renderDirty.invalidateCorrectionFrom('linear-spatial');
    this.requestRender();
  }

  /** Presentation-only Warp diagnostic; never mutates the authored stack. */
  setWarpDebugVisualization(view: WarpDebugView) {
    if (this.warpDebugVisualization === view) return;
    this.warpDebugVisualization = view;
    const changed = this.layerEffectRenderer?.setWarpDebugVisualization(
      view,
      this.imageDocument?.activeLayerId ?? null
    ) ?? false;
    if (changed) this.markDocumentDirty();
  }

  resizeScopes() {
    if (!this.scopeRuntime.resize()) return;
    this.requestRender();
  }

  resizeViewport(cssWidth: number, cssHeight: number, dpr: number, rect: ViewportRenderRect) {
    this.viewportPresentation.resize(
      this.metadata?.width ?? null,
      cssWidth,
      cssHeight,
      dpr,
      rect
    );
  }

  private writeAdjustments() {
    this.syncAdjustmentPayload();
  }

  private syncAdjustmentPayload() {
    return this.coreResources?.syncAdjustments(
      this.adjustmentState.current,
      this.metadata?.width ?? 1,
      this.metadata?.height ?? 1,
      Boolean(this.imageDocument)
    );
  }

  private writeOutputSettings(): boolean {
    if (!this.coreResources) return false;
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
    return this.coreResources.writeOutputSettings(next);
  }

  private requestRender() {
    if (!this.destroyed) this.renderScheduler.invalidate();
  }
  private syncInteractiveRenderCadence() {
    this.renderScheduler.setMinimumFrameInterval(interactionFrameIntervalMs(
      this.effectRuntime?.preferredInteractionFrameIntervalMs() ?? 0,
      this.warpInteractionActive,
      this.metadata
    ));
  }

  /**
   * Leaves preview-quality paths only when an interaction actually changed
   * their output. Export and reference measurement can therefore reuse the
   * committed frame instead of forcing the complete effect graph.
   */
  private settleInteractiveRenderQuality() {
    const effectQualityChanged = this.effectRuntime?.setInteractionActive(false) ?? false;
    this.syncInteractiveRenderCadence();
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
      curveLutBytes: this.coreResources ? CURVE_LUT_SIZE * 16 : 0,
      adjustmentLayerBytes: this.adjustmentLayerResources.estimatedBytes(),
      layerDocumentBytes: this.documentRenderer?.estimatedTextureBytes() ?? 0,
      effectBytes: (this.effectRuntime?.estimatedTextureBytes() ?? 0)
        + (this.layerEffectRenderer?.estimatedTextureBytes() ?? 0)
    }) + (this.vectorEditingOverlayBackend?.cacheMetrics().bytes ?? 0);
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
      !this.blurPipeline || !this.creativePipeline || !this.outputPipeline || !this.coreResources ||
      !this.imageResources.sourceTexture ||
      !this.effectRuntime || !this.documentRenderer || !this.imageDocument ||
      !this.displayResolvePipeline || !this.blitPipeline || !this.maskBlitPipeline ||
      !this.channelBlitPipeline || !this.differencePipeline ||
      !this.imageResources.downsampleBindGroup || !this.imageResources.blurHorizontalBindGroup || !this.imageResources.blurVerticalBindGroup ||
      !this.imageResources.creativeBindGroup ||
      !this.imageResources.blitOriginalBindGroup || !this.imageResources.blitCorrectedBindGroup ||
      !this.imageResources.differenceBindGroup ||
      !this.imageResources.blitOriginalNearestBindGroup ||
      !this.imageResources.blitCorrectedNearestBindGroup ||
      !this.imageResources.channelBindGroup ||
      !this.imageResources.channelNearestBindGroup ||
      !this.imageResources.differenceNearestBindGroup) return;

    const textInteractionTrace = this.pendingTextInteractionTrace;
    if (textInteractionTrace) recordTextInteractionTrace(textInteractionTrace, 'render-start');
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
              this.encodeLayerProcessing(layerEncoder, source, layer),
            true
          )
        );
        this.renderDirty.markDocumentCompositeRendered();
      }
      const documentTexture = this.documentCompositeTexture;
      this.layerEffectRenderer?.syncOwners(new Set(
        walkLayerTree(this.imageDocument.layers)
          .filter(({ node }) =>
            (node.type === 'raster' || node.type === 'adjustment')
            && layerNeedsEffectRuntime(node)
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
              { binding: 1, resource: { buffer: this.coreResources!.outputSettingsBuffer } }
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
      const useNearestSampling = this.viewportPresentation.sampling === 'nearest';
      const maskTexture = this.isolatedMaskLayerId
        ? this.documentRenderer.maskPresentationTexture(this.isolatedMaskLayerId)
        : null;
      if (maskTexture && maskTexture !== this.isolatedMaskTexture) {
        this.isolatedMaskTexture = maskTexture;
        this.isolatedMaskBindGroup = this.device.createBindGroup({
          layout: this.maskBlitPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: maskTexture.createView() },
            { binding: 1, resource: this.coreResources.sampler },
            { binding: 2, resource: { buffer: this.coreResources.viewBuffer } }
          ]
        });
        this.isolatedMaskNearestBindGroup = this.device.createBindGroup({
          layout: this.maskBlitPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: maskTexture.createView() },
            { binding: 1, resource: this.coreResources.nearestSampler },
            { binding: 2, resource: { buffer: this.coreResources.viewBuffer } }
          ]
        });
      } else if (!maskTexture) {
        this.isolatedMaskTexture = null;
        this.isolatedMaskBindGroup = null;
        this.isolatedMaskNearestBindGroup = null;
      }
      const isolatedMaskBindGroup = useNearestSampling
        ? this.isolatedMaskNearestBindGroup
        : this.isolatedMaskBindGroup;
      if (isolatedMaskBindGroup) {
        this.drawFullscreenPass(
          encoder,
          this.maskBlitPipeline,
          isolatedMaskBindGroup,
          canvasView
        );
      } else if (this.isolatedCompositeChannel) {
        this.drawFullscreenPass(
          encoder,
          this.channelBlitPipeline,
          useNearestSampling
            ? this.imageResources.channelNearestBindGroup
            : this.imageResources.channelBindGroup,
          canvasView
        );
      } else if (this.difference) {
        this.drawFullscreenPass(
          encoder,
          this.differencePipeline,
          useNearestSampling
            ? this.imageResources.differenceNearestBindGroup
            : this.imageResources.differenceBindGroup,
          canvasView
        );
      } else {
        this.drawFullscreenPass(
          encoder,
          this.blitPipeline,
          this.before
            ? (useNearestSampling
              ? this.imageResources.blitOriginalNearestBindGroup
              : this.imageResources.blitOriginalBindGroup)
            : (useNearestSampling
              ? this.imageResources.blitCorrectedNearestBindGroup
              : this.imageResources.blitCorrectedBindGroup),
          canvasView
        );
      }
      this.encodeVectorEditingOverlays(encoder, canvasView);
      this.renderDirty.markViewportRendered();
    }

    const histogramReadBuffer = this.histogramRuntime?.encode(encoder, {
      before: this.before,
      required: this.renderDirty.histogramRequired
    }) ?? null;
    if (histogramReadBuffer) this.renderDirty.markHistogramScheduled();
    const scopePasses = this.scopeRuntime.encode(encoder);
    this.renderTelemetry.recordScopePasses(
      scopePasses.analysisPasses,
      scopePasses.displayPasses
    );
    this.device.queue.submit([encoder.finish()]);
    if (textInteractionTrace) {
      this.pendingTextInteractionTrace = null;
      recordTextInteractionTrace(textInteractionTrace, 'queue-submit');
      void this.device.queue.onSubmittedWorkDone().then(() => {
        recordTextInteractionTrace(textInteractionTrace, 'gpu-complete');
      });
    }
    const textLatencyRenderer = this.documentRenderer;
    const submittedTextInputs = textLatencyRenderer.markTextFrameSubmitted(
      this.imageDocument,
      performance.now()
    );
    if (submittedTextInputs.length > 0) {
      void this.device.queue.onSubmittedWorkDone().then(() => {
        if (!this.destroyed && this.documentRenderer === textLatencyRenderer) {
          textLatencyRenderer.markTextFrameGpuComplete(submittedTextInputs, performance.now());
        }
      });
    }
    void this.vectorEditingOverlayBackend?.notifySubmitted();
    void this.textEditingOverlayBackend?.notifySubmitted();
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

  async exportPng(options: WebGpuPngExportOptions = {}) {
    if (!this.metadata || !this.imageResources.finalTexture) throw new Error('No processed image is available for export.');
    if (this.documentRenderer && !await this.documentRenderer.waitForTextSourcesForExport()) throw new Error('Text sources changed or could not be prepared for export.');
    this.settleInteractiveRenderQuality();
    this.renderScheduler.flush();
    await this.device.queue.onSubmittedWorkDone();

    const excludedLayerIds = new Set(options.excludedLayerIds ?? []);
    if (excludedLayerIds.size > 0) {
      return this.exportPngWithLayerExclusions(excludedLayerIds);
    }

    const pixels = await readRgba8Texture(
      this.device,
      this.imageResources.finalTexture,
      this.metadata.width,
      this.metadata.height,
      'LightTable PNG export readback'
    );
    return encodeRgba8Png(pixels, this.metadata.width, this.metadata.height);
  }

  waitForTextSourcesForExport() { return this.documentRenderer?.waitForTextSourcesForExport() ?? Promise.resolve(true); }

  private async exportPngWithLayerExclusions(excludedLayerIds: ReadonlySet<LayerId>) {
    const metadata = this.metadata;
    const document = this.imageDocument;
    const renderer = this.documentRenderer;
    const effects = this.effectRuntime;
    const core = this.coreResources;
    if (!metadata || !document || !renderer || !effects || !core
      || !this.outputPipeline || !this.displayResolvePipeline) {
      throw new Error('The GPU export pipeline is not ready yet.');
    }

    const displayTexture = this.device.createTexture({
      label: 'LightTable isolated PDF underlay display texture',
      size: [metadata.width, metadata.height],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    });
    const finalTexture = this.device.createTexture({
      label: 'LightTable isolated PDF underlay result',
      size: [metadata.width, metadata.height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
        | GPUTextureUsage.COPY_SRC
    });

    let errorScopePending = false;
    try {
      this.device.pushErrorScope('validation');
      errorScopePending = true;
      const encoder = this.device.createCommandEncoder({
        label: 'LightTable isolated PDF underlay export'
      });
      const composite = renderer.encodeComposite(
        encoder,
        document,
        (layerEncoder, source, layer) =>
          this.encodeLayerProcessing(layerEncoder, source, layer),
        false,
        excludedLayerIds
      );
      const geometry = effects.encodeSourceGeometry(encoder, composite);
      const spatial = effects.encodeLinearSpatial(encoder, geometry, { visualizeDepth: false });
      const outputBindGroup = this.device.createBindGroup({
        layout: this.outputPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: spatial.createView() },
          { binding: 1, resource: { buffer: core.outputSettingsBuffer } }
        ]
      });
      this.drawFullscreenPass(
        encoder,
        this.outputPipeline,
        outputBindGroup,
        displayTexture.createView()
      );
      const displayPost = effects.encodeDisplayPost(encoder, displayTexture, false);
      const displayResolveBindGroup = this.device.createBindGroup({
        layout: this.displayResolvePipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: displayPost.createView() }]
      });
      this.drawFullscreenPass(
        encoder,
        this.displayResolvePipeline,
        displayResolveBindGroup,
        finalTexture.createView()
      );
      this.device.queue.submit([encoder.finish()]);
      const validationError = await this.device.popErrorScope();
      errorScopePending = false;
      if (validationError) {
        throw new Error(`PDF underlay export failed: ${validationError.message}`);
      }
      await this.device.queue.onSubmittedWorkDone();
      const pixels = await readRgba8Texture(
        this.device,
        finalTexture,
        metadata.width,
        metadata.height,
        'LightTable isolated PDF underlay readback'
      );
      return encodeRgba8Png(pixels, metadata.width, metadata.height);
    } finally {
      if (errorScopePending) await this.device.popErrorScope().catch(() => null);
      displayTexture.destroy();
      finalTexture.destroy();
      // The isolated pass borrows compositor/effect scratch targets. Rebuild
      // the live document graph before any later presentation or export.
      this.markDocumentDirty();
    }
  }

  destroy() {
    this.destroyed = true;
    this.paintInteractionActive = false;
    this.warpInteractionActive = false;
    // The isolated mask texture is borrowed from the document renderer. Drop
    // references here, but let the document renderer own its destruction.
    this.isolatedMaskLayerId = null;
    this.isolatedMaskTexture = null;
    this.isolatedMaskBindGroup = null;
    this.isolatedMaskNearestBindGroup = null;
    this.viewportPresentation.dispose();
    this.device.removeEventListener('uncapturederror', this.deviceErrorListener);
    this.unsubscribeDeviceLost();
    this.sourceLoader?.destroy();
    this.sourceLoader = null;
    this.selectionAntsAnimator.dispose();
    this.renderScheduler.dispose();
    this.destroyImageResources();
    this.scopeRuntime.destroy();
    this.histogramRuntime?.destroy();
    this.histogramRuntime = null;
    this.coreResources?.destroy();
    this.coreResources = null;
    this.effectRuntime?.destroy();
    this.effectRuntime = null;
    this.layerEffectRenderer?.destroy();
    this.layerEffectRenderer = null;
    this.layerProcessingRenderer = null;
    this.documentRenderer?.destroy();
    this.documentRenderer = null;
    this.vectorEditingOverlayBackend?.dispose();
    this.vectorEditingOverlayBackend = null;
    this.textEditingOverlayBackend?.dispose();
    this.textEditingOverlayBackend = null;
    this.selectionContourOverlayBackend?.dispose();
    this.selectionContourOverlayBackend = null;
    this.textEditingOverlay = null;
  }

  private encodeVectorEditingOverlays(
    encoder: GPUCommandEncoder,
    canvasView: GPUTextureView
  ) {
    const viewportRenderState = this.viewportPresentation.state;
    if (!this.imageDocument || !viewportRenderState) return;
    const overlayScene = buildVectorDocumentEditingSceneOverlay(
      this.imageDocument,
      this.vectorSelection
    );
    const directShape = this.selectionOverlayVisible
      ? directSelectionShape(this.selectionOverlayOperations)
      : null;
    // A draft may extend over the pasteboard. Once committed, the selection
    // mask is authoritative because it is clipped to the document bounds.
    const selectionShape = directShape?.points.every((point) => (
      point.x >= 0
      && point.y >= 0
      && point.x <= this.imageDocument!.width
      && point.y <= this.imageDocument!.height
    )) ? directShape : null;
    const selectionDraft = this.selectionOverlayVisible
      ? this.selectionOverlayDraft
      : null;
    const selectionMask = this.selectionOverlayVisible && !selectionShape
      ? this.documentRenderer?.selectionMaskTexture() ?? null
      : null;
    if (
      !overlayScene.paths.length
      && !overlayScene.gradientHandles.length
      && !overlayScene.selectionFrame
      && !selectionShape
      && !selectionDraft
      && !this.zoomOverlayDraft
      && !selectionMask
      && !this.transformEditingFrame
      && !this.brushCursorOverlay
      && !this.penRubberBand
      && !this.textEditingOverlay
    ) return;
    const uniforms = viewportRenderState.uniforms;
    const target: VectorEditingOverlayTarget = {
      colorView: canvasView,
      format: this.canvasFormat,
      width: viewportRenderState.pixelWidth,
      height: viewportRenderState.pixelHeight,
      documentToViewport: {
        a: uniforms[4] / this.imageDocument.width,
        b: 0,
        c: 0,
        d: uniforms[5] / this.imageDocument.height,
        tx: uniforms[2],
        ty: uniforms[3]
      }
    };
    const animatedSelectionTheme = {
      ...SELECTION_OUTLINE_THEME,
      dashOffsetPx: this.selectionAntsAnimator.phasePx
    };
    this.vectorEditingOverlayBackend ??= new VectorEditingOverlayBackend(this.device);
    // Queries return topmost-first. Encode bottom-to-top so the topmost path's
    // handles remain the final visible editing affordance.
    for (let index = overlayScene.paths.length - 1; index >= 0; index -= 1) {
      this.vectorEditingOverlayBackend.encode(encoder, overlayScene.paths[index]!, target);
    }
    for (const overlay of overlayScene.gradientHandles) {
      this.vectorEditingOverlayBackend.encode(encoder, overlay, target, GRADIENT_GIZMO_THEME);
    }
    if (this.penRubberBand) {
      const rubberBand: VectorEditingOverlay = {
        pathId: 'pen-rubber-band',
        resourceKey: `pen-rubber-band:${this.penRubberBand.from.x}:${this.penRubberBand.from.y}:${this.penRubberBand.to.x}:${this.penRubberBand.to.y}`,
        geometryRevision: 0,
        transformRevision: 0,
        cubics: [{
          subpathId: 'pen-rubber-band', segmentIndex: 0,
          p0: this.penRubberBand.from, p1: this.penRubberBand.from,
          p2: this.penRubberBand.to, p3: this.penRubberBand.to
        }],
        anchors: [],
        handles: []
      };
      this.vectorEditingOverlayBackend.encode(encoder, rubberBand, target);
    }
    if (overlayScene.selectionFrame) {
      this.vectorEditingOverlayBackend.encodeSelectionFrame(
        encoder,
        overlayScene.selectionFrame,
        target
      );
    }
    if (this.transformEditingFrame) {
      this.vectorEditingOverlayBackend.encodeTransformFrame(
        encoder,
        this.transformEditingFrame,
        target
      );
    }
    if (selectionShape) {
      this.vectorEditingOverlayBackend.encode(
        encoder,
        buildSelectionEditingOverlay(selectionShape, 'committed'),
        target,
        animatedSelectionTheme
      );
    }
    if (selectionMask && this.coreResources) {
      this.selectionContourOverlayBackend ??= new SelectionContourOverlayBackend(
        this.device,
        this.canvasFormat
      );
      this.selectionContourOverlayBackend.encode(
        encoder,
        canvasView,
        selectionMask,
        this.coreResources.sampler,
        this.coreResources.viewBuffer,
        this.selectionAntsAnimator.phasePx
      );
    }
    if (selectionDraft) {
      this.vectorEditingOverlayBackend.encode(
        encoder,
        buildSelectionEditingOverlay(selectionDraft, 'draft'),
        target,
        animatedSelectionTheme
      );
    }
    if (this.zoomOverlayDraft) {
      this.vectorEditingOverlayBackend.encode(
        encoder,
        buildSelectionEditingOverlay(this.zoomOverlayDraft, 'draft'),
        target,
        SELECTION_OUTLINE_THEME
      );
    }
    if (this.brushCursorOverlay) {
      this.vectorEditingOverlayBackend.encode(
        encoder,
        buildBrushCursorEditingOverlay(
          this.brushCursorOverlay.center,
          this.brushCursorOverlay.diameter
        ),
        target,
        BRUSH_CURSOR_THEME
      );
    }
    if (this.textEditingOverlay) {
      this.textEditingOverlayBackend ??= new TextEditingOverlayBackend(this.device);
      this.textEditingOverlayBackend.encode(
        encoder,
        this.textEditingOverlay,
        target,
        this.textCaretVisible
      );
    }
  }

  private destroyImageResources() {
    this.textEditingOverlay = null;
    this.zoomOverlayDraft = null;
    this.documentRenderer?.destroyImageResources();
    this.adjustmentLayerRenderer.reset();
    this.adjustmentLayerResources.reset();
    this.imageDocument = null;
    this.isolatedMaskLayerId = null;
    this.isolatedMaskTexture = null;
    this.isolatedMaskBindGroup = null;
    this.isolatedMaskNearestBindGroup = null;
    this.isolatedCompositeChannel = null;
    this.brushCursorOverlay = null;
    this.penRubberBand = null;
    this.transformEditingFrame = null;
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
