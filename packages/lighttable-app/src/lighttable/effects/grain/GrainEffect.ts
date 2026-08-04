import { FULLSCREEN_VERTEX_WGSL } from '../../gpu/shaders';
import { OptionalGpuFeature } from '../../gpu/optionalGpuFeature';
import type { LightTableEffectRuntimeCallbacks, LightTableGpuEffect } from '../types';
import { cloneGrainSettings, grainIsActive, type GrainSettings } from './settings';
import { GRAIN_BLUR_WGSL, GRAIN_COMPOSITE_WGSL, GRAIN_GENERATE_WGSL } from './shaders';

const UNIFORM_FLOATS = 16;

interface GrainPipelines {
  generate: GPURenderPipeline;
  blur: GPURenderPipeline;
  composite: GPURenderPipeline;
}

export class GrainEffect implements LightTableGpuEffect<GrainSettings> {
  readonly id = 'grain';
  readonly stage = 'display-post' as const;

  private settings: GrainSettings;
  private readonly uniformBuffer: GPUBuffer;
  private readonly horizontalBuffer: GPUBuffer;
  private readonly verticalBuffer: GPUBuffer;
  private readonly pipelines: OptionalGpuFeature<GrainPipelines>;
  private generateBindGroup: GPUBindGroup | null = null;
  private horizontalBindGroup: GPUBindGroup | null = null;
  private verticalBindGroup: GPUBindGroup | null = null;
  private grainTexture: GPUTexture | null = null;
  private blurTexture: GPUTexture | null = null;
  private outputTexture: GPUTexture | null = null;
  private width = 1;
  private height = 1;
  private readonly device: GPUDevice;
  private readonly sampler: GPUSampler;

  constructor(
    device: GPUDevice,
    sampler: GPUSampler,
    vertexModule: GPUShaderModule,
    settings: GrainSettings,
    callbacks: LightTableEffectRuntimeCallbacks = {}
  ) {
    this.device = device;
    this.sampler = sampler;
    this.settings = cloneGrainSettings(settings);
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
        const [generate, blur, composite] = await Promise.all([
          createPipeline('LightTable Grain generation', GRAIN_GENERATE_WGSL),
          createPipeline('LightTable Grain blur', GRAIN_BLUR_WGSL),
          createPipeline('LightTable Grain composite', GRAIN_COMPOSITE_WGSL)
        ]);
        return { generate, blur, composite };
      },
      onReady: callbacks.requestRender,
      onError: (message) => callbacks.reportError?.(this.id, message)
    });
    this.uniformBuffer = device.createBuffer({
      label: 'LightTable Grain settings',
      size: UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.horizontalBuffer = this.createDirectionBuffer(1, 0);
    this.verticalBuffer = this.createDirectionBuffer(0, 1);
    this.writeSettings();
  }

  setSettings(settings: GrainSettings) {
    this.settings = cloneGrainSettings(settings);
    if (grainIsActive(this.settings)) {
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

  private ensureImageResources() {
    if (this.grainTexture && this.blurTexture && this.outputTexture) return;
    const pipelines = this.pipelines.resource;
    if (!pipelines) {
      void this.pipelines.ensure();
      return;
    }
    const createTexture = (label: string) => this.device.createTexture({
      label,
      size: [this.width, this.height],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    });
    this.grainTexture = createTexture('LightTable Grain noise');
    this.blurTexture = createTexture('LightTable Grain blur intermediate');
    this.outputTexture = createTexture('LightTable Grain output');
    this.generateBindGroup = this.device.createBindGroup({
      layout: pipelines.generate.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }]
    });
    this.horizontalBindGroup = this.createBlurBindGroup(pipelines.blur, this.grainTexture, this.horizontalBuffer);
    this.verticalBindGroup = this.createBlurBindGroup(pipelines.blur, this.blurTexture, this.verticalBuffer);
  }

  encode(encoder: GPUCommandEncoder, input: GPUTexture) {
    if (!grainIsActive(this.settings)) return input;
    const pipelines = this.pipelines.resource;
    if (!pipelines) {
      void this.pipelines.ensure();
      return input;
    }
    this.ensureImageResources();
    if (!this.generateBindGroup || !this.grainTexture || !this.blurTexture || !this.outputTexture ||
      !this.horizontalBindGroup || !this.verticalBindGroup) return input;

    this.draw(encoder, pipelines.generate, this.generateBindGroup, this.grainTexture);
    this.draw(encoder, pipelines.blur, this.horizontalBindGroup, this.blurTexture);
    this.draw(encoder, pipelines.blur, this.verticalBindGroup, this.grainTexture);
    const compositeBindGroup = this.device.createBindGroup({
      layout: pipelines.composite.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: input.createView() },
        { binding: 1, resource: this.grainTexture.createView() },
        { binding: 2, resource: { buffer: this.uniformBuffer } }
      ]
    });
    this.draw(encoder, pipelines.composite, compositeBindGroup, this.outputTexture);
    return this.outputTexture;
  }

  estimatedTextureBytes() {
    return this.outputTexture ? this.width * this.height * 8 * 3 : 0;
  }

  destroyImageResources() {
    this.grainTexture?.destroy();
    this.blurTexture?.destroy();
    this.outputTexture?.destroy();
    this.grainTexture = null;
    this.blurTexture = null;
    this.outputTexture = null;
    this.generateBindGroup = null;
    this.horizontalBindGroup = null;
    this.verticalBindGroup = null;
  }

  destroy() {
    this.destroyImageResources();
    this.pipelines.dispose();
    this.uniformBuffer.destroy();
    this.horizontalBuffer.destroy();
    this.verticalBuffer.destroy();
  }

  private writeSettings() {
    const value = this.settings;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, new Float32Array([
      value.amount, value.size, value.softness, value.color,
      value.shadowResponse, value.blend, value.seed, this.width,
      this.height, value.redScale, value.greenScale, value.blueScale,
      value.redContrast, value.greenContrast, value.blueContrast, 0
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

  private createBlurBindGroup(pipeline: GPURenderPipeline, texture: GPUTexture, direction: GPUBuffer) {
    return this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: texture.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: this.uniformBuffer } },
        { binding: 3, resource: { buffer: direction } }
      ]
    });
  }

  private draw(
    encoder: GPUCommandEncoder,
    pipeline: GPURenderPipeline,
    bindGroup: GPUBindGroup,
    target: GPUTexture
  ) {
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: target.createView(),
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
}
