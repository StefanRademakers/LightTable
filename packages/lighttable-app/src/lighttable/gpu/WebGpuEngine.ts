import type { BasicAdjustments, LightTableImageMetadata } from '../types';
import { decodeNativeImage } from '../image-io/NativeImageDecoder';
import type { WasmVipsDecoder } from '../image-io/WasmVipsDecoder';
import type { AdvancedDecodedImage } from '../image-io/types';
import { cloneAdjustments, createDefaultAdjustments } from '../types';
import { buildCurveLut, CURVE_LUT_SIZE } from '../curves';
import { GrainEffect } from '../effects/grain/GrainEffect';
import { HalationEffect } from '../effects/halation/HalationEffect';
import { ChromaticAberrationEffect } from '../effects/chromaticAberration/ChromaticAberrationEffect';
import { LensDistortionEffect } from '../effects/lensDistortion/LensDistortionEffect';
import { LensBlurEffect } from '../effects/lensBlur/LensBlurEffect';
import type { DepthAnalysisResult } from '../analysis/depth/types';
import {
  layerIsLocked,
  type AdjustmentLayer,
  type ImageDocument,
  type LayerId,
  type LayerNode,
  type RasterLayer
} from '../editor/document/documentTypes';
import { findDocumentLayer, findRasterLayer } from '../editor/document/layerTree';
import { layerStyleStackIsActive } from '../editor/styles/layerStyleDefaults';
import type { BrushDab } from '../editor/tools/brush/strokeBuilder';
import type { PaintChannel } from '../editor/session/editorSession';
import type { SelectionMode, SelectionOperation, SelectionShape } from '../editor/selection/selectionTypes';
import type { AffineMatrix } from '../editor/tools/transform/transformTypes';
import type { DocumentAssetBlob } from '../editor/persistence/layeredDocumentFormat';
import { LayerDocumentRenderer, type ReversiblePixelEdit } from '../editor/rendering/LayerDocumentRenderer';
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
import { alignedTargetTransform } from '../editor/autoAlign/alignmentMath';
import { calculateOutputTransformSettings } from '../outputTransform';
import {
  cloneAdjustmentStack,
  createAdjustmentStackFromBasicAdjustments,
  materializeBasicAdjustments,
  type AdjustmentStack
} from '../processing/adjustmentStack';
import { WebGpuScopeEngine, type WebGpuScopeOptions } from './WebGpuScopeEngine';
import {
  requestSharedWebGpuDevice,
  subscribeSharedWebGpuDeviceLost,
  TEXTURE_FORMATS_TIER1
} from './sharedWebGpuDevice';
import { ADJUSTMENT_UNIFORM_FLOATS, buildAdjustmentUniform } from './adjustmentUniform';
import {
  BASIC_CORRECTION_WGSL,
  DISPLAY_RESOLVE_WGSL,
  DOWNSAMPLE_WGSL,
  CREATIVE_GRADE_WGSL,
  FULLSCREEN_VERTEX_WGSL,
  GAUSSIAN_BLUR_WGSL,
  HISTOGRAM_WGSL,
  OUTPUT_TRANSFORM_WGSL,
  PRECISION_SOURCE_RESOLVE_WGSL,
  REFERENCE_DIFFERENCE_METRICS_WGSL,
  VIEWPORT_DIFFERENCE_WGSL,
  VIEWPORT_BLIT_WGSL
} from './shaders';

const HISTOGRAM_BYTE_SIZE = 768 * Uint32Array.BYTES_PER_ELEMENT;
const DIFFERENCE_METRICS_BYTE_SIZE = 8 * Uint32Array.BYTES_PER_ELEMENT;
const alignTo = (value: number, alignment: number) => Math.ceil(value / alignment) * alignment;
interface CorePipelineBundle {
  vertexModule: GPUShaderModule;
  basic: GPURenderPipeline;
  downsample: GPURenderPipeline;
  blur: GPURenderPipeline;
  creative: GPURenderPipeline;
  output: GPURenderPipeline;
  precisionSourceResolve: GPURenderPipeline;
  displayResolve: GPURenderPipeline;
  blit: GPURenderPipeline;
  difference: GPURenderPipeline;
  differenceMetrics: GPUComputePipeline;
  histogram: GPUComputePipeline;
}

const corePipelineCache = new WeakMap<GPUDevice, Map<GPUTextureFormat, CorePipelineBundle>>();
const corePipelines = (device: GPUDevice, canvasFormat: GPUTextureFormat) => {
  let byFormat = corePipelineCache.get(device);
  if (!byFormat) {
    byFormat = new Map();
    corePipelineCache.set(device, byFormat);
  }
  const cached = byFormat.get(canvasFormat);
  if (cached) return cached;
  const vertexModule = device.createShaderModule({ code: FULLSCREEN_VERTEX_WGSL });
  const createRenderPipeline = (fragmentCode: string, format: GPUTextureFormat) => device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: vertexModule, entryPoint: 'fullscreenVertex' },
    fragment: {
      module: device.createShaderModule({ code: `${FULLSCREEN_VERTEX_WGSL}\n${fragmentCode}` }),
      entryPoint: 'main',
      targets: [{ format }]
    },
    primitive: { topology: 'triangle-list' }
  });
  const precisionSourceLayout = device.createBindGroupLayout({
    label: 'LightTable precision source resolve layout',
    entries: [{
      binding: 0,
      visibility: GPUShaderStage.FRAGMENT,
      texture: { sampleType: 'unfilterable-float', viewDimension: '2d' }
    }]
  });
  const bundle: CorePipelineBundle = {
    vertexModule,
    basic: createRenderPipeline(BASIC_CORRECTION_WGSL, 'rgba16float'),
    downsample: createRenderPipeline(DOWNSAMPLE_WGSL, 'rgba16float'),
    blur: createRenderPipeline(GAUSSIAN_BLUR_WGSL, 'rgba16float'),
    creative: createRenderPipeline(CREATIVE_GRADE_WGSL, 'rgba16float'),
    output: createRenderPipeline(OUTPUT_TRANSFORM_WGSL, 'rgba16float'),
    precisionSourceResolve: device.createRenderPipeline({
      label: 'LightTable precision source resolve',
      layout: device.createPipelineLayout({ bindGroupLayouts: [precisionSourceLayout] }),
      vertex: { module: vertexModule, entryPoint: 'fullscreenVertex' },
      fragment: {
        module: device.createShaderModule({ code: `${FULLSCREEN_VERTEX_WGSL}\n${PRECISION_SOURCE_RESOLVE_WGSL}` }),
        entryPoint: 'main',
        targets: [{ format: 'rgba16float' }]
      },
      primitive: { topology: 'triangle-list' }
    }),
    displayResolve: createRenderPipeline(DISPLAY_RESOLVE_WGSL, 'rgba8unorm'),
    blit: createRenderPipeline(VIEWPORT_BLIT_WGSL, canvasFormat),
    difference: createRenderPipeline(VIEWPORT_DIFFERENCE_WGSL, canvasFormat),
    differenceMetrics: device.createComputePipeline({
      label: 'LightTable reference difference metrics',
      layout: 'auto',
      compute: {
        module: device.createShaderModule({ code: REFERENCE_DIFFERENCE_METRICS_WGSL }),
        entryPoint: 'main'
      }
    }),
    histogram: device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: device.createShaderModule({ code: HISTOGRAM_WGSL }),
        entryPoint: 'main'
      }
    })
  };
  byFormat.set(canvasFormat, bundle);
  return bundle;
};

interface ViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface AdjustmentLayerRuntime {
  uniformBuffer: GPUBuffer;
  curveTexture: GPUTexture;
  creativeBindGroup: GPUBindGroup;
}

export class WebGpuEngine {
  private readonly canvas: HTMLCanvasElement;
  private readonly device: GPUDevice;
  private readonly context: GPUCanvasContext;
  private readonly canvasFormat: GPUTextureFormat;
  private readonly callbacks: DocumentRendererCallbacks;
  private scopeEngine: WebGpuScopeEngine | null = null;
  private scopeInitialization: Promise<void> | null = null;
  private pendingScopeOptions: WebGpuScopeOptions | null = null;
  private scopeInteractionActive = false;
  private advancedImageDecoder: WasmVipsDecoder | null = null;
  private imageLoadRevision = 0;
  private documentRenderer: LayerDocumentRenderer | null = null;
  private adjustmentLayerRuntimes = new Map<LayerId, AdjustmentLayerRuntime>();
  private translationAlignmentService: FeatureAlignmentService | null = null;
  private imageDocument: ImageDocument | null = null;
  private selectionQueue: Promise<void> = Promise.resolve();
  private readonly renderScheduler: RenderInvalidationScheduler;

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
    this.renderScheduler = new RenderInvalidationScheduler(() => this.renderNow());
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

  private sourceTexture: GPUTexture | null = null;
  private correctedTexture: GPUTexture | null = null;
  private downsampleTexture: GPUTexture | null = null;
  private blurTexture: GPUTexture | null = null;
  private creativeTexture: GPUTexture | null = null;
  private displayTexture: GPUTexture | null = null;
  private finalTexture: GPUTexture | null = null;
  private curveTexture: GPUTexture | null = null;
  private histogramBuffer: GPUBuffer | null = null;
  private adjustmentBuffer: GPUBuffer | null = null;
  private outputSettingsBuffer: GPUBuffer | null = null;
  private viewBuffer: GPUBuffer | null = null;
  private histogramUniformBuffer: GPUBuffer | null = null;
  private blurHorizontalBuffer: GPUBuffer | null = null;
  private blurVerticalBuffer: GPUBuffer | null = null;
  private sampler: GPUSampler | null = null;
  private basicPipeline: GPURenderPipeline | null = null;
  private downsamplePipeline: GPURenderPipeline | null = null;
  private blurPipeline: GPURenderPipeline | null = null;
  private creativePipeline: GPURenderPipeline | null = null;
  private outputPipeline: GPURenderPipeline | null = null;
  private grainEffect: GrainEffect | null = null;
  private halationEffect: HalationEffect | null = null;
  private chromaticAberrationEffect: ChromaticAberrationEffect | null = null;
  private lensDistortionEffect: LensDistortionEffect | null = null;
  private lensBlurEffect: LensBlurEffect | null = null;
  private displayResolvePipeline: GPURenderPipeline | null = null;
  private precisionSourceResolvePipeline: GPURenderPipeline | null = null;
  private blitPipeline: GPURenderPipeline | null = null;
  private differencePipeline: GPURenderPipeline | null = null;
  private differenceMetricsPipeline: GPUComputePipeline | null = null;
  private histogramPipeline: GPUComputePipeline | null = null;
  private downsampleBindGroup: GPUBindGroup | null = null;
  private blurHorizontalBindGroup: GPUBindGroup | null = null;
  private blurVerticalBindGroup: GPUBindGroup | null = null;
  private creativeBindGroup: GPUBindGroup | null = null;
  private blitOriginalBindGroup: GPUBindGroup | null = null;
  private blitCorrectedBindGroup: GPUBindGroup | null = null;
  private differenceBindGroup: GPUBindGroup | null = null;
  private histogramOriginalBindGroup: GPUBindGroup | null = null;
  private histogramCorrectedBindGroup: GPUBindGroup | null = null;
  private metadata: LightTableImageMetadata | null = null;
  private adjustments = createDefaultAdjustments();
  private adjustmentStack = createAdjustmentStackFromBasicAdjustments(this.adjustments);
  private before = false;
  private difference = false;
  private lensBlurDepthVisualization = false;
  private correctionDirty = true;
  private blurDirty = true;
  private viewportDirty = true;
  private histogramDirty = true;
  private histogramPending = false;
  private histogramVisible = true;
  private firstFramePending = false;
  private layerStyleInitialization: Promise<void> | null = null;
  private layerStyleInitializationFailed = false;
  private readonly deviceErrorListener: EventListener;
  private readonly deviceLostListener: (info: GPUDeviceLostInfo) => void;
  private readonly unsubscribeDeviceLost: () => void;
  private destroyed = false;
  private lastReportedGpuBytes = -1;

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
    if (this.destroyed || this.scopeEngine) return;
    if (this.scopeInitialization) return this.scopeInitialization;
    this.scopeInitialization = (async () => {
      try {
        const scopeEngine = await WebGpuScopeEngine.create(
          this.device,
          scopeCanvases,
          this.callbacks.onScopeError
        );
        if (this.destroyed) {
          scopeEngine.destroy();
          return;
        }
        this.scopeEngine = scopeEngine;
        if (this.pendingScopeOptions) scopeEngine.setOptions(this.pendingScopeOptions);
        scopeEngine.setInteractionActive(this.scopeInteractionActive);
        scopeEngine.setBefore(this.before);
        if (this.metadata && this.sourceTexture && this.finalTexture) {
          scopeEngine.setTextures(this.sourceTexture, this.finalTexture, this.metadata);
        }
        scopeEngine.resize();
        this.requestRender();
      } catch (reason) {
        this.callbacks.onScopeError?.(
          reason instanceof Error ? reason.message : 'LightTable scopes could not be initialized.'
        );
      }
    })();
    try {
      await this.scopeInitialization;
    } finally {
      this.scopeInitialization = null;
    }
  }

  get imageMetadata() {
    return this.metadata;
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
    this.histogramUniformBuffer = this.device.createBuffer({
      size: 4 * Uint32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.blurHorizontalBuffer = this.createBlurUniformBuffer(1, 0);
    this.blurVerticalBuffer = this.createBlurUniformBuffer(0, 1);

    const pipelines = corePipelines(this.device, this.canvasFormat);
    this.basicPipeline = pipelines.basic;
    this.downsamplePipeline = pipelines.downsample;
    this.blurPipeline = pipelines.blur;
    this.creativePipeline = pipelines.creative;
    this.outputPipeline = pipelines.output;
    this.precisionSourceResolvePipeline = pipelines.precisionSourceResolve;
    this.grainEffect = new GrainEffect(this.device, this.sampler, pipelines.vertexModule, this.adjustments.effects.grain);
    this.documentRenderer = new LayerDocumentRenderer(this.device, this.sampler);
    this.halationEffect = new HalationEffect(
      this.device,
      this.sampler,
      pipelines.vertexModule,
      this.adjustments.effects.halation
    );
    this.chromaticAberrationEffect = new ChromaticAberrationEffect(
      this.device,
      this.sampler,
      pipelines.vertexModule,
      this.adjustments.effects.chromaticAberration
    );
    this.lensDistortionEffect = new LensDistortionEffect(
      this.device,
      this.sampler,
      pipelines.vertexModule,
      this.adjustments.effects.lensDistortion
    );
    this.lensBlurEffect = new LensBlurEffect(
      this.device,
      this.sampler,
      pipelines.vertexModule,
      this.adjustments.effects.lensBlur,
      this.adjustments.effects.lensDistortion
    );
    this.displayResolvePipeline = pipelines.displayResolve;
    this.blitPipeline = pipelines.blit;
    this.differencePipeline = pipelines.difference;
    this.differenceMetricsPipeline = pipelines.differenceMetrics;
    this.histogramPipeline = pipelines.histogram;
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
    const loadRevision = ++this.imageLoadRevision;
    if (options.decodeMode === 'preserve-precision') {
      return this.loadAdvancedImage(blob, name, options.signal, loadRevision);
    }
    return this.loadNativeImage(blob, name, options.signal, loadRevision);
  }

  private async loadNativeImage(blob: Blob, name: string, signal: AbortSignal | undefined, loadRevision: number) {
    if (signal?.aborted) throw new DOMException('The image load was cancelled.', 'AbortError');
    const decoded = await decodeNativeImage(blob);
    const { bitmap, descriptor } = decoded;
    try {
      if (signal?.aborted || loadRevision !== this.imageLoadRevision) {
        throw new DOMException('The image load was cancelled.', 'AbortError');
      }
      if (this.destroyed) throw new Error('LightTable was closed while the image was loading.');
      this.destroyImageResources();
      this.metadata = {
        name,
        width: descriptor.width,
        height: descriptor.height,
        contentType: descriptor.contentType
      };
      this.sourceTexture = this.device.createTexture({
        label: 'LightTable original sRGB image',
        size: [bitmap.width, bitmap.height],
        format: 'rgba8unorm',
        // Dawn's external-image copy path requires RenderAttachment in addition to CopyDst.
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
      });
      this.device.queue.copyExternalImageToTexture(
        { source: bitmap },
        { texture: this.sourceTexture },
        [bitmap.width, bitmap.height]
      );
      this.createImageResources(bitmap.width, bitmap.height);
      this.writeAdjustments();
      this.writeOutputSettings();
      this.correctionDirty = true;
      this.blurDirty = true;
      this.viewportDirty = true;
      this.histogramDirty = true;
      this.firstFramePending = true;
      this.requestRender();
      return this.metadata;
    } finally {
      decoded.close();
    }
  }

  private async loadAdvancedImage(
    blob: Blob,
    name: string,
    signal: AbortSignal | undefined,
    loadRevision: number
  ) {
    const decodeStartedAt = performance.now();
    if (!this.advancedImageDecoder) {
      const { WasmVipsDecoder: AdvancedDecoder } = await import('../image-io/WasmVipsDecoder');
      if (signal?.aborted || loadRevision !== this.imageLoadRevision) {
        throw new DOMException('The image load was cancelled.', 'AbortError');
      }
      this.advancedImageDecoder = new AdvancedDecoder();
    }
    const decoded = await this.advancedImageDecoder.decode(blob, signal);
    if (signal?.aborted || loadRevision !== this.imageLoadRevision) {
      throw new DOMException('The image load was cancelled.', 'AbortError');
    }
    if (this.destroyed) throw new Error('LightTable was closed while the image was loading.');
    if (decoded.descriptor.iccProfile && !decoded.descriptor.iccProfileAppliedToSrgb) {
      throw new Error('Precision-preserving import of embedded ICC profiles is not enabled yet.');
    }
    if (
      decoded.descriptor.sourceProfile === 'embedded-icc-to-srgb'
      && (!decoded.descriptor.iccProfile || !decoded.descriptor.iccProfileAppliedToSrgb)
    ) {
      throw new Error('The precision-preserving decoder returned inconsistent embedded ICC metadata.');
    }
    if (
      decoded.descriptor.sourceProfile === 'assumed-srgb'
      && (decoded.descriptor.iccProfile || decoded.descriptor.iccProfileAppliedToSrgb)
    ) {
      throw new Error('The precision-preserving decoder returned inconsistent assumed-sRGB metadata.');
    }
    this.installAdvancedSourceTexture(decoded, name, performance.now() - decodeStartedAt);
    return this.metadata!;
  }

  private installAdvancedSourceTexture(decoded: AdvancedDecodedImage, name: string, decodeDurationMs: number) {
    const { descriptor, pixels } = decoded;
    if (descriptor.storage === 'f32') {
      throw new Error('Floating-point image ingest is not enabled yet.');
    }
    if (descriptor.storage === 'u16' && !this.device.features.has(TEXTURE_FORMATS_TIER1)) {
      throw new Error(
        'This WebGPU adapter cannot upload 16-bit normalized images because texture-formats-tier1 is unavailable. '
        + 'Ordinary 8-bit images remain supported.'
      );
    }
    const supportedInterpretations = new Set(['srgb', 'rgb', 'rgb16', 'b-w', 'grey', 'grey16']);
    if (
      !descriptor.iccProfileAppliedToSrgb
      && !supportedInterpretations.has(descriptor.sourceInterpretation.toLowerCase())
    ) {
      throw new Error(
        `Precision-preserving import does not yet support ${descriptor.sourceInterpretation} source color.`
      );
    }
    const bytesPerChannel = descriptor.storage === 'u16' ? 2 : 1;
    const expectedBytes = descriptor.width * descriptor.height * descriptor.channels * bytesPerChannel;
    if (pixels.byteLength !== expectedBytes) {
      throw new Error(`The decoded image buffer has ${pixels.byteLength} bytes; expected ${expectedBytes}.`);
    }

    this.destroyImageResources();
    this.metadata = {
      name,
      width: descriptor.width,
      height: descriptor.height,
      contentType: descriptor.contentType,
      decoder: 'wasm-vips',
      sourceBitDepth: descriptor.sourceBitDepth,
      sourceFormat: descriptor.sourceFormat,
      sourceInterpretation: descriptor.sourceInterpretation,
      sourceProfile: descriptor.sourceProfile === 'embedded-icc-to-srgb'
        ? 'embedded ICC -> sRGB'
        : 'no embedded ICC; assumed sRGB',
      decodeDurationMs
    };
    if (descriptor.storage === 'u16') {
      if (!this.precisionSourceResolvePipeline) {
        throw new Error('The precision-preserving GPU ingest pipeline is unavailable.');
      }
      const stagingTexture = this.device.createTexture({
        label: `LightTable ${descriptor.sourceBitDepth}-bit UNORM staging image`,
        size: [descriptor.width, descriptor.height],
        format: 'rgba16unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
      });
      this.device.queue.writeTexture(
        { texture: stagingTexture },
        pixels,
        {
          offset: 0,
          bytesPerRow: descriptor.width * descriptor.channels * bytesPerChannel,
          rowsPerImage: descriptor.height
        },
        [descriptor.width, descriptor.height]
      );
      this.sourceTexture = this.device.createTexture({
        label: `LightTable original ${descriptor.sourceBitDepth}-bit sRGB working image`,
        size: [descriptor.width, descriptor.height],
        format: 'rgba16float',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT
      });
      const bindGroup = this.device.createBindGroup({
        layout: this.precisionSourceResolvePipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: stagingTexture.createView() }]
      });
      const encoder = this.device.createCommandEncoder({ label: 'LightTable precision source ingest' });
      this.drawFullscreenPass(
        encoder,
        this.precisionSourceResolvePipeline,
        bindGroup,
        this.sourceTexture.createView()
      );
      this.device.queue.submit([encoder.finish()]);
      void this.device.queue.onSubmittedWorkDone().then(
        () => stagingTexture.destroy(),
        () => stagingTexture.destroy()
      );
    } else {
      this.sourceTexture = this.device.createTexture({
        label: `LightTable original ${descriptor.sourceBitDepth}-bit sRGB image`,
        size: [descriptor.width, descriptor.height],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
      });
      this.device.queue.writeTexture(
        { texture: this.sourceTexture },
        pixels,
        {
          offset: 0,
          bytesPerRow: descriptor.width * descriptor.channels * bytesPerChannel,
          rowsPerImage: descriptor.height
        },
        [descriptor.width, descriptor.height]
      );
    }
    this.createImageResources(descriptor.width, descriptor.height);
    this.writeAdjustments();
    this.writeOutputSettings();
    this.correctionDirty = true;
    this.blurDirty = true;
    this.viewportDirty = true;
    this.histogramDirty = true;
    this.firstFramePending = true;
    this.requestRender();
  }

  setDocument(document: ImageDocument) {
    if (!this.sourceTexture || !this.documentRenderer) throw new Error('Load an image before creating its LightTable document.');
    const firstDocument = !this.imageDocument || this.imageDocument.id !== document.id;
    this.imageDocument = document;
    if (firstDocument) this.documentRenderer.initialize(document, this.sourceTexture);
    else this.documentRenderer.syncDocument(document);
    this.initializeLayerStylesIfNeeded(document);
    const adjustmentIds = new Set<LayerId>();
    const collectAdjustmentIds = (nodes: readonly LayerNode[]) => {
      nodes.forEach((node) => {
        if (node.type === 'adjustment') adjustmentIds.add(node.id);
        else if (node.type === 'group') collectAdjustmentIds(node.children);
      });
    };
    collectAdjustmentIds(document.layers);
    this.adjustmentLayerRuntimes.forEach((runtime, layerId) => {
      if (adjustmentIds.has(layerId)) return;
      this.destroyAdjustmentLayerRuntime(runtime);
      this.adjustmentLayerRuntimes.delete(layerId);
    });
    this.writeAdjustments();
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
    const changed = this.documentRenderer?.mergeLayerDown(document, topId, bottomId) ?? false;
    if (changed) this.markDocumentDirty();
    return changed;
  }

  mergeLayers(document: ImageDocument, layerIds: readonly LayerId[], destinationId: LayerId) {
    const changed = this.documentRenderer?.mergeLayers(document, layerIds, destinationId) ?? false;
    if (changed) this.markDocumentDirty();
    return changed;
  }

  flattenGroup(document: ImageDocument, groupId: LayerId, destinationId: LayerId) {
    const changed = this.documentRenderer?.flattenGroup(document, groupId, destinationId) ?? false;
    if (changed) this.markDocumentDirty();
    return changed;
  }

  flattenImage(document: ImageDocument, destinationId: LayerId) {
    const changed = this.documentRenderer?.flattenImage(document, destinationId) ?? false;
    if (changed) this.markDocumentDirty();
    return changed;
  }

  applyPixelHistory(edit: ReversiblePixelEdit, direction: 'undo' | 'redo') {
    const changed = direction === 'undo' ? edit.undo() : edit.redo();
    if (changed) this.markDocumentDirty();
    return changed;
  }

  private markDocumentDirty() {
    this.correctionDirty = true;
    this.blurDirty = true;
    this.histogramDirty = true;
    this.scopeEngine?.markImageDirty();
    this.requestRender();
  }

  private createImageResources(width: number, height: number) {
    if (!this.sourceTexture || !this.sampler || !this.adjustmentBuffer || !this.viewBuffer ||
      !this.histogramUniformBuffer || !this.blurHorizontalBuffer || !this.blurVerticalBuffer || !this.curveTexture ||
      !this.basicPipeline || !this.downsamplePipeline || !this.blurPipeline || !this.creativePipeline ||
      !this.outputPipeline || !this.outputSettingsBuffer || !this.grainEffect || !this.halationEffect ||
      !this.chromaticAberrationEffect || !this.lensDistortionEffect || !this.lensBlurEffect || !this.displayResolvePipeline ||
      !this.blitPipeline || !this.differencePipeline || !this.histogramPipeline) return;

    const downsampleWidth = Math.max(1, Math.ceil(width / 4));
    const downsampleHeight = Math.max(1, Math.ceil(height / 4));
    this.correctedTexture = this.device.createTexture({
      label: 'LightTable linear working image',
      size: [width, height],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    });
    this.downsampleTexture = this.device.createTexture({
      label: 'LightTable reduced luminance',
      size: [downsampleWidth, downsampleHeight],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    });
    this.blurTexture = this.device.createTexture({
      label: 'LightTable blurred luminance',
      size: [downsampleWidth, downsampleHeight],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    });
    this.creativeTexture = this.device.createTexture({
      label: 'LightTable linear creative grade',
      size: [width, height],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    });
    this.displayTexture = this.device.createTexture({
      label: 'LightTable display-mapped image before display effects',
      size: [width, height],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    });
    this.halationEffect.resize(width, height);
    this.grainEffect.resize(width, height);
    this.chromaticAberrationEffect.resize(width, height);
    this.lensDistortionEffect.resize(width, height);
    this.lensBlurEffect.resize(width, height);
    this.finalTexture = this.device.createTexture({
      label: 'LightTable display-encoded result',
      size: [width, height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST
    });
    this.histogramBuffer = this.device.createBuffer({
      size: HISTOGRAM_BYTE_SIZE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
    });

    this.downsampleBindGroup = this.device.createBindGroup({
      layout: this.downsamplePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.correctedTexture.createView() },
        { binding: 1, resource: this.sampler }
      ]
    });
    this.blurHorizontalBindGroup = this.device.createBindGroup({
      layout: this.blurPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.downsampleTexture.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: this.blurHorizontalBuffer } }
      ]
    });
    this.blurVerticalBindGroup = this.device.createBindGroup({
      layout: this.blurPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.blurTexture.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: this.blurVerticalBuffer } }
      ]
    });
    this.creativeBindGroup = this.device.createBindGroup({
      layout: this.creativePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.correctedTexture.createView() },
        { binding: 1, resource: this.downsampleTexture.createView() },
        { binding: 2, resource: this.sampler },
        { binding: 3, resource: { buffer: this.adjustmentBuffer } },
        { binding: 4, resource: this.curveTexture.createView() }
      ]
    });
    this.blitOriginalBindGroup = this.device.createBindGroup({
      layout: this.blitPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.sourceTexture.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: this.viewBuffer } }
      ]
    });
    this.blitCorrectedBindGroup = this.device.createBindGroup({
      layout: this.blitPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.finalTexture.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: this.viewBuffer } }
      ]
    });
    this.differenceBindGroup = this.device.createBindGroup({
      layout: this.differencePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.sourceTexture.createView() },
        { binding: 1, resource: this.finalTexture.createView() },
        { binding: 2, resource: this.sampler },
        { binding: 3, resource: { buffer: this.viewBuffer } }
      ]
    });
    this.histogramOriginalBindGroup = this.device.createBindGroup({
      layout: this.histogramPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.sourceTexture.createView() },
        { binding: 1, resource: { buffer: this.histogramBuffer } },
        { binding: 2, resource: { buffer: this.histogramUniformBuffer } }
      ]
    });
    this.histogramCorrectedBindGroup = this.device.createBindGroup({
      layout: this.histogramPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.finalTexture.createView() },
        { binding: 1, resource: { buffer: this.histogramBuffer } },
        { binding: 2, resource: { buffer: this.histogramUniformBuffer } }
      ]
    });
    if (this.metadata) this.scopeEngine?.setTextures(this.sourceTexture, this.finalTexture, this.metadata);
  }

  setAdjustments(adjustments: BasicAdjustments) {
    this.adjustmentStack = createAdjustmentStackFromBasicAdjustments(
      adjustments,
      this.adjustmentStack
    );
    this.applyMaterializedAdjustments(materializeBasicAdjustments(this.adjustmentStack));
  }

  setAdjustmentStack(stack: AdjustmentStack) {
    this.adjustmentStack = cloneAdjustmentStack(stack);
    this.applyMaterializedAdjustments(materializeBasicAdjustments(this.adjustmentStack));
  }

  getAdjustmentStack() {
    return cloneAdjustmentStack(this.adjustmentStack);
  }

  private applyMaterializedAdjustments(adjustments: BasicAdjustments) {
    this.adjustments = cloneAdjustments(adjustments);
    this.grainEffect?.setSettings(this.adjustments.effects.grain);
    this.halationEffect?.setSettings(this.adjustments.effects.halation);
    this.chromaticAberrationEffect?.setSettings(this.adjustments.effects.chromaticAberration);
    this.lensDistortionEffect?.setSettings(this.adjustments.effects.lensDistortion);
    this.lensBlurEffect?.setSettings(this.adjustments.effects.lensBlur);
    this.lensBlurEffect?.setDistortionSettings(this.adjustments.effects.lensDistortion);
    this.writeCurveLut();
    this.writeAdjustments();
    this.writeOutputSettings();
    this.correctionDirty = true;
    this.blurDirty = true;
    this.histogramDirty = true;
    this.scopeEngine?.markImageDirty();
    this.requestRender();
  }

  setDepthMap(depth: DepthAnalysisResult) {
    this.lensBlurEffect?.setDepthMap(depth);
    this.writeOutputSettings();
    this.correctionDirty = true;
    this.histogramDirty = true;
    this.scopeEngine?.markImageDirty();
    this.requestRender();
  }

  setBefore(before: boolean) {
    if (this.before === before) return;
    this.before = before;
    if (before) this.difference = false;
    this.viewportDirty = true;
    this.histogramDirty = true;
    this.scopeEngine?.setBefore(before);
    this.requestRender();
  }

  setDifference(difference: boolean) {
    if (this.difference === difference) return;
    this.difference = difference;
    if (difference) this.before = false;
    this.viewportDirty = true;
    // Scopes remain tied to the reconstructed image. A difference image is a
    // diagnostic view, not a grade source and must not silently replace them.
    this.scopeEngine?.setBefore(false);
    this.requestRender();
  }

  async measureReferenceDifference(threshold = 2 / 255): Promise<ReferenceDifferenceMetrics> {
    if (!this.metadata || !this.sourceTexture || !this.finalTexture || !this.differenceMetricsPipeline) {
      throw new Error('No Photoshop reference and LightTable reconstruction are available for comparison.');
    }
    await this.layerStyleInitialization;
    this.correctionDirty = true;
    this.renderScheduler.flush();
    await this.device.queue.onSubmittedWorkDone();

    const maximumSamples = 4_000_000;
    const stride = Math.max(
      1,
      Math.ceil(Math.sqrt((this.metadata.width * this.metadata.height) / maximumSamples))
    );
    const metricsBuffer = this.device.createBuffer({
      label: 'LightTable reference difference metrics',
      size: DIFFERENCE_METRICS_BYTE_SIZE,
      // clearBuffer() requires COPY_DST. Without it the command buffer becomes
      // invalid and a zero-filled readback can masquerade as a perfect match.
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
    });
    const uniformBuffer = this.device.createBuffer({
      label: 'LightTable reference difference settings',
      size: 4 * Uint32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    const readBuffer = this.device.createBuffer({
      label: 'LightTable reference difference readback',
      size: DIFFERENCE_METRICS_BYTE_SIZE,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    try {
      this.device.queue.writeBuffer(uniformBuffer, 0, new Uint32Array([
        this.metadata.width,
        this.metadata.height,
        stride,
        Math.round(Math.max(0, Math.min(1, threshold)) * 255)
      ]));
      const bindGroup = this.device.createBindGroup({
        label: 'LightTable reference difference metrics',
        layout: this.differenceMetricsPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.sourceTexture.createView() },
          { binding: 1, resource: this.finalTexture.createView() },
          { binding: 2, resource: { buffer: metricsBuffer } },
          { binding: 3, resource: { buffer: uniformBuffer } }
        ]
      });
      const encoder = this.device.createCommandEncoder({
        label: 'LightTable measure reference difference'
      });
      encoder.clearBuffer(metricsBuffer);
      const pass = encoder.beginComputePass({
        label: 'LightTable reference difference metrics'
      });
      pass.setPipeline(this.differenceMetricsPipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(
        Math.ceil(this.metadata.width / stride / 8),
        Math.ceil(this.metadata.height / stride / 8)
      );
      pass.end();
      encoder.copyBufferToBuffer(
        metricsBuffer,
        0,
        readBuffer,
        0,
        DIFFERENCE_METRICS_BYTE_SIZE
      );
      this.device.queue.submit([encoder.finish()]);
      await readBuffer.mapAsync(GPUMapMode.READ);
      const values = new Uint32Array(readBuffer.getMappedRange().slice(0));
      readBuffer.unmap();
      const sampledPixels = values[0] ?? 0;
      const differingPixels = values[1] ?? 0;
      if (sampledPixels === 0) {
        throw new Error('LightTable reference comparison produced no samples.');
      }
      return {
        sampledPixels,
        differingPixels,
        differingPixelPercentage: differingPixels / sampledPixels * 100,
        meanAbsoluteRgbError: (values[2] ?? 0) / (sampledPixels * 3 * 255),
        maximumChannelError: (values[3] ?? 0) / 255,
        meanAbsoluteAlphaError: (values[4] ?? 0) / (sampledPixels * 255),
        maximumAlphaError: (values[5] ?? 0) / 255,
        threshold,
        stride
      };
    } finally {
      if (readBuffer.mapState === 'mapped') readBuffer.unmap();
      readBuffer.destroy();
      uniformBuffer.destroy();
      metricsBuffer.destroy();
    }
  }

  setScopeOptions(histogramVisible: boolean, options: WebGpuScopeOptions) {
    const histogramBecameVisible = histogramVisible && !this.histogramVisible;
    this.histogramVisible = histogramVisible;
    this.pendingScopeOptions = { ...options };
    if (histogramBecameVisible) this.histogramDirty = true;
    this.scopeEngine?.setOptions(options);
    this.requestRender();
  }

  setScopeInteractionActive(active: boolean) {
    this.scopeInteractionActive = active;
    this.scopeEngine?.setInteractionActive(active);
    this.requestRender();
  }

  setLensBlurInteractionActive(active: boolean) {
    this.lensBlurEffect?.setInteractionActive(active);
    this.correctionDirty = true;
    this.histogramDirty = true;
    this.scopeEngine?.markImageDirty();
    this.requestRender();
  }

  setLayerStyleInteractionActive(active: boolean) {
    if (this.documentRenderer?.setLayerStyleInteractionActive(active)) {
      this.markDocumentDirty();
    }
  }

  setLensBlurDepthVisualization(visualize: boolean) {
    this.lensBlurDepthVisualization = visualize;
    this.lensBlurEffect?.setDepthVisualization(visualize);
    this.writeOutputSettings();
    this.correctionDirty = true;
    this.requestRender();
  }

  resizeScopes() {
    this.scopeEngine?.resize();
    this.requestRender();
  }

  resizeViewport(cssWidth: number, cssHeight: number, dpr: number, rect: ViewportRect) {
    const pixelWidth = Math.max(1, Math.round(cssWidth * dpr));
    const pixelHeight = Math.max(1, Math.round(cssHeight * dpr));
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
    if (this.viewBuffer) {
      this.device.queue.writeBuffer(this.viewBuffer, 0, new Float32Array([
        pixelWidth,
        pixelHeight,
        rect.x * dpr,
        rect.y * dpr,
        Math.max(1, rect.width * dpr),
        Math.max(1, rect.height * dpr),
        12 * dpr,
        0
      ]));
    }
    this.viewportDirty = true;
    this.requestRender();
  }

  private writeAdjustments() {
    if (!this.adjustmentBuffer) return;
    this.device.queue.writeBuffer(this.adjustmentBuffer, 0, buildAdjustmentUniform(
      this.adjustments,
      this.metadata?.width ?? 1,
      this.metadata?.height ?? 1,
      Boolean(this.imageDocument)
    ));
  }

  private writeCurveLut() {
    if (!this.curveTexture) return;
    this.device.queue.writeTexture(
      { texture: this.curveTexture },
      buildCurveLut(this.adjustments.curves),
      { bytesPerRow: CURVE_LUT_SIZE * 4 * Float32Array.BYTES_PER_ELEMENT },
      { width: CURVE_LUT_SIZE, height: 1 }
    );
  }

  private writeOutputSettings() {
    if (!this.outputSettingsBuffer) return;
    const settings = calculateOutputTransformSettings(this.adjustments);
    const visualizingDepth = Boolean(
      this.adjustments.effects.lensBlur.enabled &&
      this.lensBlurDepthVisualization &&
      this.lensBlurEffect?.hasDepth
    );
    this.device.queue.writeBuffer(this.outputSettingsBuffer, 0, new Float32Array([
      visualizingDepth ? 0 : settings.whites,
      visualizingDepth ? 0 : settings.shoulderStrength,
      visualizingDepth ? 0 : (settings.active ? 1 : 0),
      visualizingDepth ? 0 : settings.vignette,
      this.metadata?.width ?? 1,
      this.metadata?.height ?? 1,
      0,
      0
    ]));
  }

  private requestRender() {
    if (!this.destroyed) this.renderScheduler.invalidate();
  }

  private createAdjustmentLayerRuntime(layer: AdjustmentLayer): AdjustmentLayerRuntime {
    if (!this.sampler || !this.creativePipeline || !this.correctedTexture ||
      !this.downsampleTexture) {
      throw new Error('LightTable adjustment-layer resources are not initialized.');
    }
    const uniformBuffer = this.device.createBuffer({
      label: `LightTable adjustment layer uniforms: ${layer.name}`,
      size: ADJUSTMENT_UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    const curveTexture = this.device.createTexture({
      label: `LightTable adjustment layer curve LUT: ${layer.name}`,
      size: [CURVE_LUT_SIZE, 1],
      format: 'rgba32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
    return {
      uniformBuffer,
      curveTexture,
      creativeBindGroup: this.device.createBindGroup({
        layout: this.creativePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.correctedTexture.createView() },
          { binding: 1, resource: this.downsampleTexture.createView() },
          { binding: 2, resource: this.sampler },
          { binding: 3, resource: { buffer: uniformBuffer } },
          { binding: 4, resource: curveTexture.createView() }
        ]
      })
    };
  }

  private adjustmentLayerRuntime(layer: AdjustmentLayer) {
    const current = this.adjustmentLayerRuntimes.get(layer.id);
    if (current) return current;
    const runtime = this.createAdjustmentLayerRuntime(layer);
    this.adjustmentLayerRuntimes.set(layer.id, runtime);
    return runtime;
  }

  private estimatedGpuTextureBytes() {
    if (!this.metadata) return 0;
    const pixels = this.metadata.width * this.metadata.height;
    const reducedPixels = Math.ceil(this.metadata.width / 4) * Math.ceil(this.metadata.height / 4);
    let bytes = 0;
    if (this.sourceTexture) bytes += pixels * ((this.metadata.sourceBitDepth ?? 8) > 8 ? 8 : 4);
    if (this.correctedTexture) bytes += pixels * 8;
    if (this.downsampleTexture) bytes += reducedPixels * 8;
    if (this.blurTexture) bytes += reducedPixels * 8;
    if (this.creativeTexture) bytes += pixels * 8;
    if (this.displayTexture) bytes += pixels * 8;
    if (this.finalTexture) bytes += pixels * 4;
    if (this.curveTexture) bytes += CURVE_LUT_SIZE * 16;
    bytes += this.adjustmentLayerRuntimes.size * (
      ADJUSTMENT_UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT + CURVE_LUT_SIZE * 16
    );
    bytes += this.documentRenderer?.estimatedTextureBytes() ?? 0;
    bytes += this.grainEffect?.estimatedTextureBytes() ?? 0;
    bytes += this.halationEffect?.estimatedTextureBytes() ?? 0;
    bytes += this.chromaticAberrationEffect?.estimatedTextureBytes() ?? 0;
    bytes += this.lensDistortionEffect?.estimatedTextureBytes() ?? 0;
    bytes += this.lensBlurEffect?.estimatedTextureBytes() ?? 0;
    return bytes;
  }

  private reportGpuMemoryEstimate() {
    const bytes = this.estimatedGpuTextureBytes();
    if (bytes === this.lastReportedGpuBytes) return;
    this.lastReportedGpuBytes = bytes;
    this.callbacks.onGpuMemoryEstimate?.(bytes);
  }

  private destroyAdjustmentLayerRuntime(runtime: AdjustmentLayerRuntime) {
    runtime.uniformBuffer.destroy();
    runtime.curveTexture.destroy();
  }

  private destroyAdjustmentLayerRuntimes() {
    this.adjustmentLayerRuntimes.forEach((runtime) => this.destroyAdjustmentLayerRuntime(runtime));
    this.adjustmentLayerRuntimes.clear();
  }

  private renderNow() {
    if (this.destroyed || !this.metadata || !this.correctedTexture || !this.downsampleTexture ||
      !this.blurTexture || !this.creativeTexture || !this.displayTexture ||
      !this.finalTexture || !this.basicPipeline || !this.downsamplePipeline ||
      !this.blurPipeline || !this.creativePipeline || !this.outputPipeline || !this.outputSettingsBuffer ||
      !this.sourceTexture || !this.sampler || !this.adjustmentBuffer || !this.curveTexture ||
      !this.halationEffect || !this.grainEffect || !this.chromaticAberrationEffect || !this.lensDistortionEffect ||
      !this.lensBlurEffect || !this.documentRenderer || !this.imageDocument ||
      !this.displayResolvePipeline || !this.blitPipeline || !this.differencePipeline ||
      !this.downsampleBindGroup || !this.blurHorizontalBindGroup || !this.blurVerticalBindGroup ||
      !this.creativeBindGroup ||
      !this.blitOriginalBindGroup || !this.blitCorrectedBindGroup || !this.differenceBindGroup) return;

    // Capture the first validation failure from the frame. Without a scope the
    // useful error is commonly followed by—and visually replaced with—the
    // generic "Invalid CommandBuffer due to a previous error" message.
    this.device.pushErrorScope('validation');
    const encoder = this.device.createCommandEncoder({ label: 'LightTable render' });
    let renderedCorrection = false;
    if (this.correctionDirty) {
      const hasVisibleAdjustment = (nodes: readonly LayerNode[]): boolean =>
        nodes.some((node) => node.visible && (
          node.type === 'adjustment'
          || (node.type === 'group' && hasVisibleAdjustment(node.children))
        ));
      const documentHasAdjustment = hasVisibleAdjustment(this.imageDocument.layers);
      const documentTexture = this.documentRenderer.encodeComposite(
        encoder,
        this.imageDocument,
        (layerEncoder, source, layer) => {
          const layerAdjustments = materializeBasicAdjustments(layer.adjustmentStack);
          // Queue writes are not encoded into command-buffer order. Give every
          // Adjustment Layer its own uniforms/LUT so multiple layers cannot
          // observe the final layer's settings. The large image work textures
          // remain shared: their render passes execute sequentially inside the
          // command buffer, before each corresponding mix pass.
          const runtime = this.adjustmentLayerRuntime(layer);
          this.device.queue.writeBuffer(
            runtime.uniformBuffer,
            0,
            buildAdjustmentUniform(
              layerAdjustments,
              this.metadata?.width ?? 1,
              this.metadata?.height ?? 1,
              true
            )
          );
          this.device.queue.writeTexture(
            { texture: runtime.curveTexture },
            buildCurveLut(layerAdjustments.curves),
            { bytesPerRow: CURVE_LUT_SIZE * 4 * Float32Array.BYTES_PER_ELEMENT },
            { width: CURVE_LUT_SIZE, height: 1 }
          );
          const basicBindGroup = this.device.createBindGroup({
            layout: this.basicPipeline!.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: source.createView() },
              { binding: 1, resource: this.sampler! },
              { binding: 2, resource: { buffer: runtime.uniformBuffer } }
            ]
          });
          this.drawFullscreenPass(
            layerEncoder,
            this.basicPipeline!,
            basicBindGroup,
            this.correctedTexture!.createView()
          );
          if (Math.abs(layerAdjustments.clarity) > 0.00001 || Math.abs(layerAdjustments.dehaze) > 0.00001) {
            this.drawFullscreenPass(
              layerEncoder,
              this.downsamplePipeline!,
              this.downsampleBindGroup!,
              this.downsampleTexture!.createView()
            );
            this.drawFullscreenPass(
              layerEncoder,
              this.blurPipeline!,
              this.blurHorizontalBindGroup!,
              this.blurTexture!.createView()
            );
            this.drawFullscreenPass(
              layerEncoder,
              this.blurPipeline!,
              this.blurVerticalBindGroup!,
              this.downsampleTexture!.createView()
            );
          }
          this.drawFullscreenPass(
            layerEncoder,
            this.creativePipeline!,
            runtime.creativeBindGroup,
            this.creativeTexture!.createView()
          );
          return this.creativeTexture!;
        }
      );
      const distortedTexture = this.lensDistortionEffect.encode(encoder, documentTexture);
      const sourceGeometryTexture = this.chromaticAberrationEffect.encode(encoder, distortedTexture);
      let gradeTexture = sourceGeometryTexture;
      if (!documentHasAdjustment) {
        const basicBindGroup = this.device.createBindGroup({
          layout: this.basicPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: sourceGeometryTexture.createView() },
            { binding: 1, resource: this.sampler },
            { binding: 2, resource: { buffer: this.adjustmentBuffer } }
          ]
        });
        this.drawFullscreenPass(encoder, this.basicPipeline, basicBindGroup, this.correctedTexture.createView());
        if ((Math.abs(this.adjustments.clarity) > 0.00001 || Math.abs(this.adjustments.dehaze) > 0.00001) && this.blurDirty) {
          this.drawFullscreenPass(encoder, this.downsamplePipeline, this.downsampleBindGroup, this.downsampleTexture.createView());
          this.drawFullscreenPass(encoder, this.blurPipeline, this.blurHorizontalBindGroup, this.blurTexture.createView());
          this.drawFullscreenPass(encoder, this.blurPipeline, this.blurVerticalBindGroup, this.downsampleTexture.createView());
          this.blurDirty = false;
        }
        this.drawFullscreenPass(encoder, this.creativePipeline, this.creativeBindGroup, this.creativeTexture.createView());
        gradeTexture = this.creativeTexture;
      }
      const lensBlurTexture = this.lensBlurEffect.encode(encoder, gradeTexture);
      const visualizingDepth = Boolean(
        this.adjustments.effects.lensBlur.enabled &&
        this.lensBlurDepthVisualization &&
        this.lensBlurEffect.hasDepth
      );
      const linearEffectTexture = visualizingDepth
        ? lensBlurTexture
        : this.halationEffect.encode(encoder, lensBlurTexture);
      const outputBindGroup = this.device.createBindGroup({
        layout: this.outputPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: linearEffectTexture.createView() },
          { binding: 1, resource: { buffer: this.outputSettingsBuffer } }
        ]
      });
      this.drawFullscreenPass(encoder, this.outputPipeline, outputBindGroup, this.displayTexture.createView());
      const displayEffectTexture = visualizingDepth
        ? this.displayTexture
        : this.grainEffect.encode(encoder, this.displayTexture);
      const displayResolveBindGroup = this.device.createBindGroup({
        layout: this.displayResolvePipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: displayEffectTexture.createView() }]
      });
      this.drawFullscreenPass(
        encoder,
        this.displayResolvePipeline,
        displayResolveBindGroup,
        this.finalTexture.createView()
      );
      this.correctionDirty = false;
      this.viewportDirty = true;
      renderedCorrection = true;
    }
    if (this.viewportDirty) {
      const canvasView = this.context.getCurrentTexture().createView();
      if (this.difference) {
        this.drawFullscreenPass(
          encoder,
          this.differencePipeline,
          this.differenceBindGroup,
          canvasView
        );
      } else {
        this.drawFullscreenPass(
          encoder,
          this.blitPipeline,
          this.before ? this.blitOriginalBindGroup : this.blitCorrectedBindGroup,
          canvasView
        );
      }
      this.viewportDirty = false;
    }

    const histogramReadBuffer = this.encodeHistogram(encoder);
    this.scopeEngine?.encode(encoder);
    this.device.queue.submit([encoder.finish()]);
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
    if (histogramReadBuffer) void this.readHistogram(histogramReadBuffer);
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

  private encodeHistogram(encoder: GPUCommandEncoder) {
    if (!this.histogramVisible || !this.histogramDirty || this.histogramPending || !this.metadata || !this.histogramBuffer ||
      !this.histogramUniformBuffer || !this.histogramPipeline ||
      !this.histogramOriginalBindGroup || !this.histogramCorrectedBindGroup) return null;
    const stride = Math.max(1, Math.ceil(Math.sqrt((this.metadata.width * this.metadata.height) / 750_000)));
    this.device.queue.writeBuffer(this.histogramUniformBuffer, 0, new Uint32Array([
      this.metadata.width,
      this.metadata.height,
      stride,
      0
    ]));
    encoder.clearBuffer(this.histogramBuffer);
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.histogramPipeline);
    pass.setBindGroup(0, this.before ? this.histogramOriginalBindGroup : this.histogramCorrectedBindGroup);
    pass.dispatchWorkgroups(
      Math.ceil(this.metadata.width / stride / 8),
      Math.ceil(this.metadata.height / stride / 8)
    );
    pass.end();
    const readBuffer = this.device.createBuffer({
      size: HISTOGRAM_BYTE_SIZE,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    encoder.copyBufferToBuffer(this.histogramBuffer, 0, readBuffer, 0, HISTOGRAM_BYTE_SIZE);
    this.histogramDirty = false;
    this.histogramPending = true;
    return readBuffer;
  }

  private async readHistogram(buffer: GPUBuffer) {
    try {
      await buffer.mapAsync(GPUMapMode.READ);
      const values = new Uint32Array(buffer.getMappedRange().slice(0));
      buffer.unmap();
      this.callbacks.onHistogram?.({
        red: values.slice(0, 256),
        green: values.slice(256, 512),
        blue: values.slice(512, 768)
      });
    } finally {
      buffer.destroy();
      this.histogramPending = false;
      if (this.histogramDirty) this.requestRender();
    }
  }

  async exportPng() {
    if (!this.metadata || !this.finalTexture) throw new Error('No processed image is available for export.');
    this.lensBlurEffect?.setInteractionActive(false);
    this.correctionDirty = true;
    this.renderScheduler.flush();
    await this.device.queue.onSubmittedWorkDone();

    const bytesPerPixel = 4;
    const unpaddedBytesPerRow = this.metadata.width * bytesPerPixel;
    const bytesPerRow = alignTo(unpaddedBytesPerRow, 256);
    const readBuffer = this.device.createBuffer({
      size: bytesPerRow * this.metadata.height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    const pixels = new Uint8ClampedArray(unpaddedBytesPerRow * this.metadata.height);
    try {
      const encoder = this.device.createCommandEncoder({ label: 'LightTable PNG export readback' });
      encoder.copyTextureToBuffer(
        { texture: this.finalTexture },
        { buffer: readBuffer, bytesPerRow, rowsPerImage: this.metadata.height },
        [this.metadata.width, this.metadata.height]
      );
      this.device.queue.submit([encoder.finish()]);
      await readBuffer.mapAsync(GPUMapMode.READ);
      const mapped = new Uint8Array(readBuffer.getMappedRange());
      for (let row = 0; row < this.metadata.height; row += 1) {
        const sourceStart = row * bytesPerRow;
        pixels.set(mapped.subarray(sourceStart, sourceStart + unpaddedBytesPerRow), row * unpaddedBytesPerRow);
      }
      readBuffer.unmap();
    } finally {
      if (readBuffer.mapState === 'mapped') readBuffer.unmap();
      readBuffer.destroy();
    }

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = this.metadata.width;
    exportCanvas.height = this.metadata.height;
    const context = exportCanvas.getContext('2d');
    if (!context) throw new Error('PNG encoder canvas could not be created.');
    context.putImageData(new ImageData(pixels, this.metadata.width, this.metadata.height), 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => {
      exportCanvas.toBlob((result) => result ? resolve(result) : reject(new Error('PNG encoding failed.')), 'image/png');
    });
    return blob;
  }

  destroy() {
    this.destroyed = true;
    this.device.removeEventListener('uncapturederror', this.deviceErrorListener);
    this.unsubscribeDeviceLost();
    this.imageLoadRevision += 1;
    this.renderScheduler.dispose();
    this.destroyImageResources();
    this.scopeEngine?.destroy();
    this.scopeEngine = null;
    this.advancedImageDecoder?.destroy();
    this.advancedImageDecoder = null;
    this.adjustmentBuffer?.destroy();
    this.outputSettingsBuffer?.destroy();
    this.viewBuffer?.destroy();
    this.histogramUniformBuffer?.destroy();
    this.blurHorizontalBuffer?.destroy();
    this.blurVerticalBuffer?.destroy();
    this.curveTexture?.destroy();
    this.grainEffect?.destroy();
    this.grainEffect = null;
    this.halationEffect?.destroy();
    this.halationEffect = null;
    this.chromaticAberrationEffect?.destroy();
    this.chromaticAberrationEffect = null;
    this.lensDistortionEffect?.destroy();
    this.lensDistortionEffect = null;
    this.lensBlurEffect?.destroy();
    this.lensBlurEffect = null;
    this.documentRenderer?.destroy();
    this.documentRenderer = null;
  }

  private destroyImageResources() {
    this.documentRenderer?.destroyImageResources();
    this.destroyAdjustmentLayerRuntimes();
    this.imageDocument = null;
    this.scopeEngine?.clearTextures();
    this.sourceTexture?.destroy();
    this.correctedTexture?.destroy();
    this.downsampleTexture?.destroy();
    this.blurTexture?.destroy();
    this.creativeTexture?.destroy();
    this.displayTexture?.destroy();
    this.halationEffect?.destroyImageResources();
    this.grainEffect?.destroyImageResources();
    this.chromaticAberrationEffect?.destroyImageResources();
    this.lensDistortionEffect?.destroyImageResources();
    this.lensBlurEffect?.destroyImageResources();
    this.finalTexture?.destroy();
    this.histogramBuffer?.destroy();
    this.sourceTexture = null;
    this.correctedTexture = null;
    this.downsampleTexture = null;
    this.blurTexture = null;
    this.creativeTexture = null;
    this.displayTexture = null;
    this.finalTexture = null;
    this.histogramBuffer = null;
    this.differenceBindGroup = null;
  }
}
