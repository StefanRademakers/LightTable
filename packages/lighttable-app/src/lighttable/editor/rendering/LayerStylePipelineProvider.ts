import { FULLSCREEN_VERTEX_WGSL } from '../../gpu/shaders';
import { LAYER_STYLE_EFFECT_WGSL } from './layerShaders';

interface LayerStylePipelineEntry {
  module: GPUShaderModule;
  pipeline: Promise<GPURenderPipeline>;
}

const cache = new WeakMap<GPUDevice, LayerStylePipelineEntry>();

/**
 * Contains the optional Layer Style shader lifecycle. A failed asynchronous
 * compile is evicted so another document may retry after recovery; the
 * baseline document pipelines remain independent.
 */
export class LayerStylePipelineProvider {
  private pipelineValue: GPURenderPipeline | null = null;
  private moduleValue: GPUShaderModule | null = null;

  constructor(
    private readonly device: GPUDevice,
    private readonly fullscreenModule: GPUShaderModule
  ) {}

  get pipeline() {
    return this.pipelineValue;
  }

  async initialize() {
    if (this.pipelineValue) return this.pipelineValue;
    let entry = cache.get(this.device);
    if (!entry) {
      const module = this.device.createShaderModule({
        label: 'LightTable Layer Style effect shader',
        code: `${FULLSCREEN_VERTEX_WGSL}\n${LAYER_STYLE_EFFECT_WGSL}`
      });
      entry = {
        module,
        pipeline: this.device.createRenderPipelineAsync({
          label: 'LightTable Layer Style effect',
          layout: 'auto',
          vertex: { module: this.fullscreenModule, entryPoint: 'fullscreenVertex' },
          fragment: {
            module,
            entryPoint: 'main',
            targets: [{ format: 'rgba16float' }]
          },
          primitive: { topology: 'triangle-list' }
        })
      };
      cache.set(this.device, entry);
    }
    this.moduleValue = entry.module;
    try {
      this.pipelineValue = await entry.pipeline;
      return this.pipelineValue;
    } catch (reason) {
      cache.delete(this.device);
      this.moduleValue = null;
      throw reason;
    }
  }

  async shaderErrors() {
    if (!this.moduleValue) return [];
    const compilation = await this.moduleValue.getCompilationInfo();
    return compilation.messages
      .filter((message) => message.type === 'error')
      .map((message) => {
        const location = message.lineNum
          ? `:${message.lineNum}:${message.linePos ?? 0}`
          : '';
        return `${location} ${message.message}`.trim();
      });
  }
}
