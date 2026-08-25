import { FULLSCREEN_VERTEX_WGSL } from '../../gpu/shaders';
import {
  LAYER_STYLE_BEVEL_BLUR_WGSL,
  LAYER_STYLE_BEVEL_FLOOD_WGSL,
  LAYER_STYLE_BEVEL_SEED_WGSL,
  LAYER_STYLE_DENSE_GAUSSIAN_BLUR_WGSL,
  LAYER_STYLE_EFFECT_WGSL,
  LAYER_STYLE_GAUSSIAN_BLUR_WGSL
} from './layerShaders';

interface LayerStylePipelineEntry {
  modules: readonly GPUShaderModule[];
  effect: Promise<GPURenderPipeline>;
  blur: Promise<GPURenderPipeline>;
  denseBlur: Promise<GPURenderPipeline>;
  bevelBlur: Promise<GPURenderPipeline>;
  bevelSeed: Promise<GPURenderPipeline>;
  bevelFlood: Promise<GPURenderPipeline>;
}

const cache = new WeakMap<GPUDevice, LayerStylePipelineEntry>();

/**
 * Contains the optional Layer Style shader lifecycle. A failed asynchronous
 * compile is evicted so another document may retry after recovery; the
 * baseline document pipelines remain independent.
 */
export class LayerStylePipelineProvider {
  private pipelineValue: GPURenderPipeline | null = null;
  private blurPipelineValue: GPURenderPipeline | null = null;
  private denseBlurPipelineValue: GPURenderPipeline | null = null;
  private bevelBlurPipelineValue: GPURenderPipeline | null = null;
  private bevelSeedPipelineValue: GPURenderPipeline | null = null;
  private bevelFloodPipelineValue: GPURenderPipeline | null = null;
  private moduleValues: readonly GPUShaderModule[] = [];

  constructor(
    private readonly device: GPUDevice,
    private readonly fullscreenModule: GPUShaderModule
  ) {}

  get pipeline() {
    return this.pipelineValue;
  }

  get blurPipeline() {
    return this.blurPipelineValue;
  }

  get denseBlurPipeline() { return this.denseBlurPipelineValue; }

  get bevelBlurPipeline() { return this.bevelBlurPipelineValue; }

  get bevelSeedPipeline() { return this.bevelSeedPipelineValue; }

  get bevelFloodPipeline() { return this.bevelFloodPipelineValue; }

  async initialize() {
    if (this.pipelineValue) return this.pipelineValue;
    let entry = cache.get(this.device);
    if (!entry) {
      const effectModule = this.device.createShaderModule({
        label: 'LightTable Layer Style effect shader',
        code: `${FULLSCREEN_VERTEX_WGSL}\n${LAYER_STYLE_EFFECT_WGSL}`
      });
      const blurModule = this.device.createShaderModule({
        label: 'LightTable Layer Style Gaussian blur shader',
        code: `${FULLSCREEN_VERTEX_WGSL}\n${LAYER_STYLE_GAUSSIAN_BLUR_WGSL}`
      });
      const bevelBlurModule = this.device.createShaderModule({
        label: 'LightTable Bevel dense Gaussian blur shader',
        code: `${FULLSCREEN_VERTEX_WGSL}\n${LAYER_STYLE_BEVEL_BLUR_WGSL}`
      });
      const denseBlurModule = this.device.createShaderModule({
        label: 'LightTable Layer Style dense Gaussian blur shader',
        code: `${FULLSCREEN_VERTEX_WGSL}\n${LAYER_STYLE_DENSE_GAUSSIAN_BLUR_WGSL}`
      });
      const bevelSeedModule = this.device.createShaderModule({
        label: 'LightTable Bevel seed shader',
        code: `${FULLSCREEN_VERTEX_WGSL}\n${LAYER_STYLE_BEVEL_SEED_WGSL}`
      });
      const bevelFloodModule = this.device.createShaderModule({
        label: 'LightTable Bevel distance flood shader',
        code: `${FULLSCREEN_VERTEX_WGSL}\n${LAYER_STYLE_BEVEL_FLOOD_WGSL}`
      });
      entry = {
        modules: [effectModule, blurModule, denseBlurModule, bevelBlurModule, bevelSeedModule, bevelFloodModule],
        effect: this.device.createRenderPipelineAsync({
          label: 'LightTable Layer Style effect',
          layout: 'auto',
          vertex: { module: this.fullscreenModule, entryPoint: 'fullscreenVertex' },
          fragment: {
            module: effectModule,
            entryPoint: 'main',
            targets: [{ format: 'rgba16float' }]
          },
          primitive: { topology: 'triangle-list' }
        }),
        blur: this.device.createRenderPipelineAsync({
          label: 'LightTable Layer Style Gaussian blur',
          layout: 'auto',
          vertex: { module: this.fullscreenModule, entryPoint: 'fullscreenVertex' },
          fragment: {
            module: blurModule,
            entryPoint: 'main',
            targets: [{ format: 'rgba16float' }]
          },
          primitive: { topology: 'triangle-list' }
        }),
        denseBlur: this.device.createRenderPipelineAsync({
          label: 'LightTable Layer Style dense Gaussian blur',
          layout: 'auto',
          vertex: { module: this.fullscreenModule, entryPoint: 'fullscreenVertex' },
          fragment: {
            module: denseBlurModule,
            entryPoint: 'main',
            targets: [{ format: 'rgba16float' }]
          },
          primitive: { topology: 'triangle-list' }
        }),
        bevelBlur: this.device.createRenderPipelineAsync({
          label: 'LightTable Bevel high-precision Gaussian blur',
          layout: 'auto',
          vertex: { module: this.fullscreenModule, entryPoint: 'fullscreenVertex' },
          fragment: {
            module: bevelBlurModule,
            entryPoint: 'main',
            targets: [{ format: 'rgba32float' }]
          },
          primitive: { topology: 'triangle-list' }
        }),
        bevelSeed: this.device.createRenderPipelineAsync({
          label: 'LightTable Bevel anti-aliased seed',
          layout: 'auto',
          vertex: { module: this.fullscreenModule, entryPoint: 'fullscreenVertex' },
          fragment: {
            module: bevelSeedModule,
            entryPoint: 'main',
            targets: [{ format: 'rgba16float' }]
          },
          primitive: { topology: 'triangle-list' }
        }),
        bevelFlood: this.device.createRenderPipelineAsync({
          label: 'LightTable Bevel bounded distance flood',
          layout: 'auto',
          vertex: { module: this.fullscreenModule, entryPoint: 'fullscreenVertex' },
          fragment: {
            module: bevelFloodModule,
            entryPoint: 'main',
            targets: [{ format: 'rgba16float' }]
          },
          primitive: { topology: 'triangle-list' }
        })
      };
      cache.set(this.device, entry);
    }
    this.moduleValues = entry.modules;
    try {
      [
        this.pipelineValue,
        this.blurPipelineValue,
        this.denseBlurPipelineValue,
        this.bevelBlurPipelineValue,
        this.bevelSeedPipelineValue,
        this.bevelFloodPipelineValue
      ] = await Promise.all([
        entry.effect,
        entry.blur,
        entry.denseBlur,
        entry.bevelBlur,
        entry.bevelSeed,
        entry.bevelFlood
      ]);
      return this.pipelineValue;
    } catch (reason) {
      cache.delete(this.device);
      this.moduleValues = [];
      this.blurPipelineValue = null;
      this.denseBlurPipelineValue = null;
      this.bevelBlurPipelineValue = null;
      this.bevelSeedPipelineValue = null;
      this.bevelFloodPipelineValue = null;
      throw reason;
    }
  }

  async shaderErrors() {
    const compilations = await Promise.all(
      this.moduleValues.map((module) => module.getCompilationInfo())
    );
    return [...new Set(compilations.flatMap((compilation) => compilation.messages)
      .filter((message) => message.type === 'error')
      .map((message) => {
        const location = message.lineNum
          ? `:${message.lineNum}:${message.linePos ?? 0}`
          : '';
        return `${location} ${message.message}`.trim();
      }))];
  }
}
