import type { LightTableImageMetadata } from '../types';
import {
  DEFAULT_SCOPE_SETTINGS,
  resolveScopeSampleGrid,
  type ScopeQuality,
  type VectorscopeRange
} from '../scopes';
import { FULLSCREEN_VERTEX_WGSL } from './shaders';
import {
  COMBINED_SCOPE_ANALYSIS_WGSL,
  HUE_DISTRIBUTION_ANALYSIS_WGSL,
  HUE_DISTRIBUTION_DISPLAY_WGSL,
  PARADE_SCOPE_ANALYSIS_WGSL,
  PARADE_SCOPE_DISPLAY_WGSL,
  VECTOR_SCOPE_ANALYSIS_WGSL,
  VECTOR_SCOPE_DISPLAY_WGSL
} from './scopeShaders';
import { InteractiveRefreshGate } from '../application/rendering/interactiveRefreshGate';

const PARADE_BIN_BYTES = 3 * 256 * 256 * Uint32Array.BYTES_PER_ELEMENT;
const VECTOR_BIN_BYTES = 256 * 256 * Uint32Array.BYTES_PER_ELEMENT;
const HUE_BIN_BYTES = 256 * Uint32Array.BYTES_PER_ELEMENT;
const SCOPE_UNIFORM_BYTES = 8 * Uint32Array.BYTES_PER_ELEMENT;
const DISPLAY_UNIFORM_BYTES = 4 * Float32Array.BYTES_PER_ELEMENT;

export interface WebGpuScopeOptions {
  hueDistributionVisible: boolean;
  paradeVisible: boolean;
  vectorscopeVisible: boolean;
  quality: ScopeQuality;
  traceBrightness: number;
  vectorscopeRange: VectorscopeRange;
  vectorscopeZoom2x: boolean;
}

interface ScopeCanvases {
  hueDistribution: HTMLCanvasElement;
  colorMixerHueDistribution?: HTMLCanvasElement;
  parade: HTMLCanvasElement;
  vectorscope: HTMLCanvasElement;
}

const DEFAULT_OPTIONS: WebGpuScopeOptions = {
  hueDistributionVisible: true,
  paradeVisible: true,
  vectorscopeVisible: true,
  quality: DEFAULT_SCOPE_SETTINGS.quality,
  traceBrightness: DEFAULT_SCOPE_SETTINGS.traceBrightness,
  vectorscopeRange: DEFAULT_SCOPE_SETTINGS.vectorscopeRange,
  vectorscopeZoom2x: DEFAULT_SCOPE_SETTINGS.vectorscopeZoom2x
};

const rangeIndex = (range: VectorscopeRange) => {
  if (range === 'low') return 1;
  if (range === 'mid') return 2;
  if (range === 'high') return 3;
  return 0;
};

export class WebGpuScopeEngine {
  private readonly device: GPUDevice;
  private readonly canvases: ScopeCanvases;
  private readonly hueDistributionContext: GPUCanvasContext;
  private readonly colorMixerHueDistributionContext: GPUCanvasContext | null;
  private readonly paradeContext: GPUCanvasContext;
  private readonly vectorscopeContext: GPUCanvasContext;
  private readonly canvasFormat: GPUTextureFormat;
  private readonly onError?: (message: string) => void;

  private hueBins: GPUBuffer | null = null;
  private paradeBins: GPUBuffer | null = null;
  private vectorBins: GPUBuffer | null = null;
  private hueMaximum: GPUBuffer | null = null;
  private paradeMaximum: GPUBuffer | null = null;
  private vectorMaximum: GPUBuffer | null = null;
  private analysisUniforms: GPUBuffer | null = null;
  private hueDisplayUniforms: GPUBuffer | null = null;
  private paradeDisplayUniforms: GPUBuffer | null = null;
  private vectorDisplayUniforms: GPUBuffer | null = null;

  private hueAnalysisPipeline: GPUComputePipeline | null = null;
  private paradeAnalysisPipeline: GPUComputePipeline | null = null;
  private vectorAnalysisPipeline: GPUComputePipeline | null = null;
  private combinedAnalysisPipeline: GPUComputePipeline | null = null;
  private hueDisplayPipeline: GPURenderPipeline | null = null;
  private paradeDisplayPipeline: GPURenderPipeline | null = null;
  private vectorDisplayPipeline: GPURenderPipeline | null = null;

  private hueSourceBindGroup: GPUBindGroup | null = null;
  private hueFinalBindGroup: GPUBindGroup | null = null;
  private paradeSourceBindGroup: GPUBindGroup | null = null;
  private paradeFinalBindGroup: GPUBindGroup | null = null;
  private vectorSourceBindGroup: GPUBindGroup | null = null;
  private vectorFinalBindGroup: GPUBindGroup | null = null;
  private combinedSourceBindGroup: GPUBindGroup | null = null;
  private combinedFinalBindGroup: GPUBindGroup | null = null;
  private hueDisplayBindGroup: GPUBindGroup | null = null;
  private paradeDisplayBindGroup: GPUBindGroup | null = null;
  private vectorDisplayBindGroup: GPUBindGroup | null = null;

  private metadata: LightTableImageMetadata | null = null;
  private options = { ...DEFAULT_OPTIONS };
  private before = false;
  private interactionActive = false;
  private readonly interactiveRefresh = new InteractiveRefreshGate(100);
  private analysisDirty = true;
  private displayDirty = true;
  private failed = false;
  private destroyed = false;

  private constructor(
    device: GPUDevice,
    canvases: ScopeCanvases,
    canvasFormat: GPUTextureFormat,
    hueDistributionContext: GPUCanvasContext,
    colorMixerHueDistributionContext: GPUCanvasContext | null,
    paradeContext: GPUCanvasContext,
    vectorscopeContext: GPUCanvasContext,
    onError?: (message: string) => void
  ) {
    this.device = device;
    this.canvases = canvases;
    this.canvasFormat = canvasFormat;
    this.hueDistributionContext = hueDistributionContext;
    this.colorMixerHueDistributionContext = colorMixerHueDistributionContext;
    this.paradeContext = paradeContext;
    this.vectorscopeContext = vectorscopeContext;
    this.onError = onError;
  }

  static async create(device: GPUDevice, canvases: ScopeCanvases, onError?: (message: string) => void) {
    const hueDistributionContext = canvases.hueDistribution.getContext('webgpu');
    const colorMixerHueDistributionContext =
      canvases.colorMixerHueDistribution?.getContext('webgpu') ?? null;
    const paradeContext = canvases.parade.getContext('webgpu');
    const vectorscopeContext = canvases.vectorscope.getContext('webgpu');
    if (!hueDistributionContext || !paradeContext || !vectorscopeContext) {
      throw new Error('The browser could not create the LightTable scope canvases.');
    }
    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    const configure = (context: GPUCanvasContext) => context.configure({
      device,
      format: canvasFormat,
      alphaMode: 'opaque',
      colorSpace: 'srgb'
    });
    configure(hueDistributionContext);
    if (colorMixerHueDistributionContext) configure(colorMixerHueDistributionContext);
    configure(paradeContext);
    configure(vectorscopeContext);
    const engine = new WebGpuScopeEngine(
      device,
      canvases,
      canvasFormat,
      hueDistributionContext,
      colorMixerHueDistributionContext,
      paradeContext,
      vectorscopeContext,
      onError
    );
    device.pushErrorScope('validation');
    device.pushErrorScope('out-of-memory');
    engine.createResources();
    const memoryError = await device.popErrorScope();
    const validationError = await device.popErrorScope();
    const error = memoryError ?? validationError;
    if (error) {
      engine.destroy();
      throw new Error(`LightTable scopes are unavailable: ${error.message}`);
    }
    return engine;
  }

  private createResources() {
    const createStorageBuffer = (label: string, size: number) => this.device.createBuffer({
      label,
      size,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    this.hueBins = createStorageBuffer('LightTable Hue Distribution bins', HUE_BIN_BYTES);
    this.paradeBins = createStorageBuffer('LightTable RGB Parade density bins', PARADE_BIN_BYTES);
    this.vectorBins = createStorageBuffer('LightTable Vectorscope density bins', VECTOR_BIN_BYTES);
    this.hueMaximum = createStorageBuffer('LightTable Hue Distribution maximum', 4);
    this.paradeMaximum = createStorageBuffer('LightTable RGB Parade maximum', 4);
    this.vectorMaximum = createStorageBuffer('LightTable Vectorscope maximum', 4);
    this.analysisUniforms = this.device.createBuffer({
      label: 'LightTable scope analysis uniforms',
      size: SCOPE_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.hueDisplayUniforms = this.device.createBuffer({
      label: 'LightTable Hue Distribution display uniforms',
      size: DISPLAY_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.paradeDisplayUniforms = this.device.createBuffer({
      label: 'LightTable RGB Parade display uniforms',
      size: DISPLAY_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.vectorDisplayUniforms = this.device.createBuffer({
      label: 'LightTable Vectorscope display uniforms',
      size: DISPLAY_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    const computePipeline = (label: string, code: string) => this.device.createComputePipeline({
      label,
      layout: 'auto',
      compute: { module: this.device.createShaderModule({ code }), entryPoint: 'main' }
    });
    this.hueAnalysisPipeline = computePipeline('LightTable Hue Distribution analysis', HUE_DISTRIBUTION_ANALYSIS_WGSL);
    this.paradeAnalysisPipeline = computePipeline('LightTable RGB Parade analysis', PARADE_SCOPE_ANALYSIS_WGSL);
    this.vectorAnalysisPipeline = computePipeline('LightTable Vectorscope analysis', VECTOR_SCOPE_ANALYSIS_WGSL);
    this.combinedAnalysisPipeline = computePipeline('LightTable combined scope analysis', COMBINED_SCOPE_ANALYSIS_WGSL);
    const vertexModule = this.device.createShaderModule({ code: FULLSCREEN_VERTEX_WGSL });
    const displayPipeline = (label: string, code: string) => this.device.createRenderPipeline({
      label,
      layout: 'auto',
      vertex: { module: vertexModule, entryPoint: 'fullscreenVertex' },
      fragment: {
        module: this.device.createShaderModule({ code: `${FULLSCREEN_VERTEX_WGSL}\n${code}` }),
        entryPoint: 'main',
        targets: [{ format: this.canvasFormat }]
      },
      primitive: { topology: 'triangle-list' }
    });
    this.hueDisplayPipeline = displayPipeline('LightTable Hue Distribution display', HUE_DISTRIBUTION_DISPLAY_WGSL);
    this.paradeDisplayPipeline = displayPipeline('LightTable RGB Parade display', PARADE_SCOPE_DISPLAY_WGSL);
    this.vectorDisplayPipeline = displayPipeline('LightTable Vectorscope display', VECTOR_SCOPE_DISPLAY_WGSL);
    if (!this.hueBins || !this.paradeBins || !this.vectorBins ||
      !this.hueMaximum || !this.paradeMaximum || !this.vectorMaximum ||
      !this.hueDisplayUniforms || !this.paradeDisplayUniforms || !this.vectorDisplayUniforms ||
      !this.hueDisplayPipeline || !this.paradeDisplayPipeline || !this.vectorDisplayPipeline) return;
    this.hueDisplayBindGroup = this.device.createBindGroup({
      layout: this.hueDisplayPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.hueBins } },
        { binding: 1, resource: { buffer: this.hueMaximum } },
        { binding: 2, resource: { buffer: this.hueDisplayUniforms } }
      ]
    });
    this.paradeDisplayBindGroup = this.device.createBindGroup({
      layout: this.paradeDisplayPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.paradeBins } },
        { binding: 1, resource: { buffer: this.paradeMaximum } },
        { binding: 2, resource: { buffer: this.paradeDisplayUniforms } }
      ]
    });
    this.vectorDisplayBindGroup = this.device.createBindGroup({
      layout: this.vectorDisplayPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.vectorBins } },
        { binding: 1, resource: { buffer: this.vectorMaximum } },
        { binding: 2, resource: { buffer: this.vectorDisplayUniforms } }
      ]
    });
  }

  setTextures(source: GPUTexture, final: GPUTexture, metadata: LightTableImageMetadata) {
    if (this.destroyed || this.failed || !this.analysisUniforms || !this.hueBins || !this.paradeBins || !this.vectorBins ||
      !this.hueMaximum || !this.paradeMaximum || !this.vectorMaximum || !this.hueAnalysisPipeline || !this.paradeAnalysisPipeline ||
      !this.vectorAnalysisPipeline || !this.combinedAnalysisPipeline) return;
    this.metadata = metadata;
    const sourceView = source.createView();
    const finalView = final.createView();
    const makeHueDistribution = (view: GPUTextureView) => this.device.createBindGroup({
      layout: this.hueAnalysisPipeline!.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: view },
        { binding: 1, resource: { buffer: this.hueBins! } },
        { binding: 2, resource: { buffer: this.hueMaximum! } },
        { binding: 3, resource: { buffer: this.analysisUniforms! } }
      ]
    });
    const makeParade = (view: GPUTextureView) => this.device.createBindGroup({
      layout: this.paradeAnalysisPipeline!.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: view },
        { binding: 1, resource: { buffer: this.paradeBins! } },
        { binding: 2, resource: { buffer: this.paradeMaximum! } },
        { binding: 3, resource: { buffer: this.analysisUniforms! } }
      ]
    });
    const makeVector = (view: GPUTextureView) => this.device.createBindGroup({
      layout: this.vectorAnalysisPipeline!.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: view },
        { binding: 1, resource: { buffer: this.vectorBins! } },
        { binding: 2, resource: { buffer: this.vectorMaximum! } },
        { binding: 3, resource: { buffer: this.analysisUniforms! } }
      ]
    });
    const makeCombined = (view: GPUTextureView) => this.device.createBindGroup({
      layout: this.combinedAnalysisPipeline!.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: view },
        { binding: 1, resource: { buffer: this.paradeBins! } },
        { binding: 2, resource: { buffer: this.paradeMaximum! } },
        { binding: 3, resource: { buffer: this.vectorBins! } },
        { binding: 4, resource: { buffer: this.vectorMaximum! } },
        { binding: 5, resource: { buffer: this.analysisUniforms! } }
      ]
    });
    this.hueSourceBindGroup = makeHueDistribution(sourceView);
    this.hueFinalBindGroup = makeHueDistribution(finalView);
    this.paradeSourceBindGroup = makeParade(sourceView);
    this.paradeFinalBindGroup = makeParade(finalView);
    this.vectorSourceBindGroup = makeVector(sourceView);
    this.vectorFinalBindGroup = makeVector(finalView);
    this.combinedSourceBindGroup = makeCombined(sourceView);
    this.combinedFinalBindGroup = makeCombined(finalView);
    this.analysisDirty = true;
    this.displayDirty = true;
  }

  clearTextures() {
    this.metadata = null;
    this.hueSourceBindGroup = null;
    this.hueFinalBindGroup = null;
    this.paradeSourceBindGroup = null;
    this.paradeFinalBindGroup = null;
    this.vectorSourceBindGroup = null;
    this.vectorFinalBindGroup = null;
    this.combinedSourceBindGroup = null;
    this.combinedFinalBindGroup = null;
  }

  setBefore(before: boolean) {
    if (this.before === before) return;
    this.before = before;
    this.analysisDirty = true;
  }

  setOptions(options: WebGpuScopeOptions) {
    const analysisChanged = options.hueDistributionVisible !== this.options.hueDistributionVisible ||
      options.paradeVisible !== this.options.paradeVisible ||
      options.vectorscopeVisible !== this.options.vectorscopeVisible ||
      options.quality !== this.options.quality ||
      options.vectorscopeRange !== this.options.vectorscopeRange;
    const displayChanged = analysisChanged || options.traceBrightness !== this.options.traceBrightness ||
      options.vectorscopeZoom2x !== this.options.vectorscopeZoom2x;
    this.options = { ...options };
    if (analysisChanged) this.analysisDirty = true;
    if (displayChanged) {
      this.displayDirty = true;
      this.writeDisplayUniforms();
    }
  }

  setInteractionActive(active: boolean) {
    if (this.interactionActive === active) return;
    this.interactionActive = active;
    this.interactiveRefresh.setActive(active);
    if (this.options.quality === 'auto') this.analysisDirty = true;
  }

  markImageDirty() {
    this.analysisDirty = true;
  }

  resize() {
    this.displayDirty = true;
  }

  hasVisibleScopes() {
    return this.options.hueDistributionVisible || this.options.paradeVisible || this.options.vectorscopeVisible;
  }

  encode(encoder: GPUCommandEncoder) {
    if (this.destroyed || this.failed || !this.metadata || !this.hasVisibleScopes()) return;
    this.device.pushErrorScope('validation');
    try {
      this.encodeInternal(encoder);
    } catch (reason) {
      this.disable(reason instanceof Error ? reason.message : 'Unknown scope rendering error');
    } finally {
      void this.device.popErrorScope().then((error) => {
        if (error) this.disable(error.message);
      });
    }
  }

  private encodeInternal(encoder: GPUCommandEncoder) {
    if (!this.metadata) return;
    if (this.analysisDirty && this.interactiveRefresh.shouldRefresh(performance.now())) {
      this.encodeAnalysis(encoder);
    }
    if (this.displayDirty) {
      if (this.options.hueDistributionVisible) this.encodeDisplay(
        encoder,
        this.canvases.hueDistribution,
        this.hueDistributionContext,
        this.hueDisplayPipeline,
        this.hueDisplayBindGroup
      );
      if (
        this.options.hueDistributionVisible
        && this.canvases.colorMixerHueDistribution
        && this.colorMixerHueDistributionContext
      ) this.encodeDisplay(
        encoder,
        this.canvases.colorMixerHueDistribution,
        this.colorMixerHueDistributionContext,
        this.hueDisplayPipeline,
        this.hueDisplayBindGroup
      );
      if (this.options.paradeVisible) this.encodeDisplay(
        encoder,
        this.canvases.parade,
        this.paradeContext,
        this.paradeDisplayPipeline,
        this.paradeDisplayBindGroup
      );
      if (this.options.vectorscopeVisible) this.encodeDisplay(
        encoder,
        this.canvases.vectorscope,
        this.vectorscopeContext,
        this.vectorDisplayPipeline,
        this.vectorDisplayBindGroup
      );
      this.displayDirty = false;
    }
  }

  private encodeAnalysis(encoder: GPUCommandEncoder) {
    if (!this.metadata || !this.analysisUniforms || !this.hueBins || !this.paradeBins || !this.vectorBins ||
      !this.hueMaximum || !this.paradeMaximum || !this.vectorMaximum) return;
    const sampleSize = resolveScopeSampleGrid(
      this.metadata.width,
      this.metadata.height,
      this.options.quality,
      this.interactionActive
    );
    const values = new ArrayBuffer(SCOPE_UNIFORM_BYTES);
    new Uint32Array(values, 0, 4).set([
      this.metadata.width,
      this.metadata.height,
      sampleSize.width,
      sampleSize.height
    ]);
    new Float32Array(values, 16, 4).set([
      rangeIndex(this.options.vectorscopeRange),
      0.3,
      0.7,
      this.before ? 0 : 1
    ]);
    this.device.queue.writeBuffer(this.analysisUniforms, 0, values);
    const parade = this.options.paradeVisible;
    const vector = this.options.vectorscopeVisible;
    let pipeline: GPUComputePipeline | null = null;
    let bindGroup: GPUBindGroup | null = null;
    if (parade && vector) {
      encoder.clearBuffer(this.paradeBins);
      encoder.clearBuffer(this.paradeMaximum);
      encoder.clearBuffer(this.vectorBins);
      encoder.clearBuffer(this.vectorMaximum);
      pipeline = this.combinedAnalysisPipeline;
      bindGroup = this.before ? this.combinedSourceBindGroup : this.combinedFinalBindGroup;
    } else if (parade) {
      encoder.clearBuffer(this.paradeBins);
      encoder.clearBuffer(this.paradeMaximum);
      pipeline = this.paradeAnalysisPipeline;
      bindGroup = this.before ? this.paradeSourceBindGroup : this.paradeFinalBindGroup;
    } else if (vector) {
      encoder.clearBuffer(this.vectorBins);
      encoder.clearBuffer(this.vectorMaximum);
      pipeline = this.vectorAnalysisPipeline;
      bindGroup = this.before ? this.vectorSourceBindGroup : this.vectorFinalBindGroup;
    }
    if (this.options.hueDistributionVisible) {
      encoder.clearBuffer(this.hueBins);
      encoder.clearBuffer(this.hueMaximum);
    }
    const pass = encoder.beginComputePass({ label: 'LightTable visible scope analysis' });
    const workgroupsX = Math.ceil(sampleSize.width / 8);
    const workgroupsY = Math.ceil(sampleSize.height / 8);
    if (pipeline && bindGroup) {
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(workgroupsX, workgroupsY);
    }
    if (this.options.hueDistributionVisible) {
      const hueBindGroup = this.before ? this.hueSourceBindGroup : this.hueFinalBindGroup;
      if (this.hueAnalysisPipeline && hueBindGroup) {
        pass.setPipeline(this.hueAnalysisPipeline);
        pass.setBindGroup(0, hueBindGroup);
        pass.dispatchWorkgroups(workgroupsX, workgroupsY);
      }
    }
    pass.end();
    this.analysisDirty = false;
    this.displayDirty = true;
    this.writeDisplayUniforms();
  }

  private writeDisplayUniforms() {
    const brightness = Math.max(10, Math.min(400, this.options.traceBrightness)) / 100;
    if (this.hueDisplayUniforms) {
      this.device.queue.writeBuffer(this.hueDisplayUniforms, 0, new Float32Array([brightness, 0, 0, 0]));
    }
    if (this.paradeDisplayUniforms) {
      this.device.queue.writeBuffer(this.paradeDisplayUniforms, 0, new Float32Array([brightness, 1, 0, 0]));
    }
    if (this.vectorDisplayUniforms) {
      this.device.queue.writeBuffer(this.vectorDisplayUniforms, 0, new Float32Array([
        brightness,
        this.options.vectorscopeZoom2x ? 2 : 1,
        0,
        0
      ]));
    }
  }

  private encodeDisplay(
    encoder: GPUCommandEncoder,
    canvas: HTMLCanvasElement,
    context: GPUCanvasContext,
    pipeline: GPURenderPipeline | null,
    bindGroup: GPUBindGroup | null
  ) {
    if (!pipeline || !bindGroup) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const pass = encoder.beginRenderPass({
      label: 'LightTable scope display',
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        clearValue: { r: 0.018, g: 0.023, b: 0.03, a: 1 },
        loadOp: 'clear',
        storeOp: 'store'
      }]
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
  }

  private disable(message: string) {
    if (this.failed) return;
    this.failed = true;
    this.onError?.(`LightTable scopes disabled: ${message}`);
  }

  destroy() {
    this.destroyed = true;
    this.clearTextures();
    this.hueBins?.destroy();
    this.paradeBins?.destroy();
    this.vectorBins?.destroy();
    this.hueMaximum?.destroy();
    this.paradeMaximum?.destroy();
    this.vectorMaximum?.destroy();
    this.analysisUniforms?.destroy();
    this.hueDisplayUniforms?.destroy();
    this.paradeDisplayUniforms?.destroy();
    this.vectorDisplayUniforms?.destroy();
    this.hueBins = null;
    this.paradeBins = null;
    this.vectorBins = null;
    this.hueMaximum = null;
    this.paradeMaximum = null;
    this.vectorMaximum = null;
    this.analysisUniforms = null;
    this.hueDisplayUniforms = null;
    this.paradeDisplayUniforms = null;
    this.vectorDisplayUniforms = null;
  }
}
