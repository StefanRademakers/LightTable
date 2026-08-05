import { FULLSCREEN_VERTEX_WGSL } from '../../gpu/shaders';
import {
  LAYER_STYLE_EFFECT_WGSL,
  LAYER_STYLE_GAUSSIAN_BLUR_WGSL
} from './layerShaders';

interface LayerStylePipelineEntry {
  modules: readonly GPUShaderModule[];
  effect: Promise<GPURenderPipeline>;
  blur: Promise<GPURenderPipeline>;
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
      entry = {
        modules: [effectModule, blurModule],
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
        })
      };
      cache.set(this.device, entry);
    }
    this.moduleValues = entry.modules;
    try {
      [this.pipelineValue, this.blurPipelineValue] = await Promise.all([
        entry.effect,
        entry.blur
      ]);
      return this.pipelineValue;
    } catch (reason) {
      cache.delete(this.device);
      this.moduleValues = [];
      this.blurPipelineValue = null;
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
