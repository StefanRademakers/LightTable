import { FULLSCREEN_VERTEX_WGSL } from '../../gpu/shaders';
import { OptionalGpuFeature } from '../../gpu/optionalGpuFeature';
import type { LightTableEffectRuntimeCallbacks, LightTableGpuEffect } from '../types';
import { cloneHalationSettings, halationIsActive, type HalationSettings } from './settings';
import { HALATION_BLUR_WGSL, HALATION_COMPOSITE_WGSL, HALATION_EXTRACT_WGSL } from './shaders';

interface HalationPipelines {
  extract: GPURenderPipeline;
  blur: GPURenderPipeline;
  composite: GPURenderPipeline;
}

export class HalationEffect implements LightTableGpuEffect<HalationSettings> {
  readonly id = 'halation';
  readonly stage = 'linear-spatial' as const;
  private readonly device: GPUDevice;
  private readonly sampler: GPUSampler;
  private readonly pipelines: OptionalGpuFeature<HalationPipelines>;
  private settings: HalationSettings;
  private readonly settingsBuffer: GPUBuffer;
  private readonly horizontalBuffer: GPUBuffer;
  private readonly verticalBuffer: GPUBuffer;
  private extractTexture: GPUTexture | null = null;
  private blurTexture: GPUTexture | null = null;
  private outputTexture: GPUTexture | null = null;
  private width = 1;
  private height = 1;

  constructor(
    device: GPUDevice,
    sampler: GPUSampler,
    vertexModule: GPUShaderModule,
    settings: HalationSettings,
    callbacks: LightTableEffectRuntimeCallbacks = {}
  ) {
    this.device = device;
    this.sampler = sampler;
    this.settings = cloneHalationSettings(settings);
    const createPipeline = (label: string, fragmentCode: string) => this.device.createRenderPipelineAsync({
      label,
      layout: 'auto',
      vertex: { module: vertexModule, entryPoint: 'fullscreenVertex' },
      fragment: {
        module: this.device.createShaderModule({
          label: `${label} shader`,
          code: `${FULLSCREEN_VERTEX_WGSL}\n${fragmentCode}`
        }),
        entryPoint: 'main',
        targets: [{ format: 'rgba16float' }]
      },
      primitive: { topology: 'triangle-list' }
    });
    this.pipelines = new OptionalGpuFeature({
      id: this.id,
      compile: async () => {
        const [extract, blur, composite] = await Promise.all([
          createPipeline('LightTable Halation highlight extraction', HALATION_EXTRACT_WGSL),
          createPipeline('LightTable Halation blur', HALATION_BLUR_WGSL),
          createPipeline('LightTable Halation composite', HALATION_COMPOSITE_WGSL)
        ]);
        return { extract, blur, composite };
      },
      onReady: callbacks.requestRender,
      onError: (message) => callbacks.reportError?.(this.id, message)
    });
    this.settingsBuffer = device.createBuffer({
      label: 'LightTable Halation settings',
      size: 8 * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.horizontalBuffer = this.createDirectionBuffer(1, 0);
    this.verticalBuffer = this.createDirectionBuffer(0, 1);
    this.writeSettings();
  }

  setSettings(settings: HalationSettings) {
    this.settings = cloneHalationSettings(settings);
    if (halationIsActive(this.settings)) {
      void this.pipelines.ensure();
    }
    else this.destroyImageResources();
    this.writeSettings();
  }

  resize(width: number, height: number) {
    this.destroyImageResources();
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.writeSettings();
  }

  interactionFrameIntervalMs() {
    return halationIsActive(this.settings) ? 30 : 0;
  }

  private ensureImageResources() {
    if (this.extractTexture && this.blurTexture && this.outputTexture) return;
    const reducedWidth = Math.max(1, Math.ceil(this.width / 4));
    const reducedHeight = Math.max(1, Math.ceil(this.height / 4));
    const createTexture = (label: string, textureWidth: number, textureHeight: number) => this.device.createTexture({
      label,
      size: [textureWidth, textureHeight],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    });
    this.extractTexture = createTexture('LightTable Halation highlight energy', reducedWidth, reducedHeight);
    this.blurTexture = createTexture('LightTable Halation blur intermediate', reducedWidth, reducedHeight);
    this.outputTexture = createTexture('LightTable Halation linear output', this.width, this.height);
  }

  encode(encoder: GPUCommandEncoder, input: GPUTexture) {
    if (!halationIsActive(this.settings)) return input;
    const pipelines = this.pipelines.resource;
    if (!pipelines) {
      void this.pipelines.ensure();
      return input;
    }
    this.ensureImageResources();
    if (!this.extractTexture || !this.blurTexture || !this.outputTexture) return input;
    this.draw(encoder, pipelines.extract, this.bind(pipelines.extract, [
      input.createView(), this.sampler, { buffer: this.settingsBuffer }
    ]), this.extractTexture);

    // Two separable blur cycles produce a broad, smooth low-frequency spill
    // without a radius-sized convolution at full image resolution.
    for (let cycle = 0; cycle < 2; cycle += 1) {
      this.draw(encoder, pipelines.blur, this.bind(pipelines.blur, [
        this.extractTexture.createView(), this.sampler, { buffer: this.settingsBuffer }, { buffer: this.horizontalBuffer }
      ]), this.blurTexture);
      this.draw(encoder, pipelines.blur, this.bind(pipelines.blur, [
        this.blurTexture.createView(), this.sampler, { buffer: this.settingsBuffer }, { buffer: this.verticalBuffer }
      ]), this.extractTexture);
    }

    this.draw(encoder, pipelines.composite, this.bind(pipelines.composite, [
      input.createView(), this.extractTexture.createView(), this.sampler, { buffer: this.settingsBuffer }
    ]), this.outputTexture);
    return this.outputTexture;
  }

  estimatedTextureBytes() {
    if (!this.outputTexture) return 0;
    const reducedPixels = Math.ceil(this.width / 4) * Math.ceil(this.height / 4);
    return this.width * this.height * 8 + reducedPixels * 8 * 2;
  }

  destroyImageResources() {
    this.extractTexture?.destroy();
    this.blurTexture?.destroy();
    this.outputTexture?.destroy();
    this.extractTexture = null;
    this.blurTexture = null;
    this.outputTexture = null;
  }

  destroy() {
    this.destroyImageResources();
    this.pipelines.dispose();
    this.settingsBuffer.destroy();
    this.horizontalBuffer.destroy();
    this.verticalBuffer.destroy();
  }

  private writeSettings() {
    this.device.queue.writeBuffer(this.settingsBuffer, 0, new Float32Array([
      this.settings.amount, this.settings.radius, this.settings.threshold, this.settings.warmth,
      this.width, this.height, 0, 0
    ]));
  }

  private createDirectionBuffer(x: number, y: number) {
    const buffer = this.device.createBuffer({
      size: 4 * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.device.queue.writeBuffer(buffer, 0, new Float32Array([x, y, 0, 0]));
    return buffer;
  }

  private bind(pipeline: GPURenderPipeline, resources: GPUBindingResource[]) {
    return this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: resources.map((resource, binding) => ({ binding, resource }))
    });
  }

  private draw(encoder: GPUCommandEncoder, pipeline: GPURenderPipeline, bindGroup: GPUBindGroup, target: GPUTexture) {
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: target.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store'
      }]
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
  }
}
