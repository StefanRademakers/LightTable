import { FULLSCREEN_VERTEX_WGSL } from '../../gpu/shaders';
import type { LightTableGpuEffect } from '../types';
import { cloneGrainSettings, grainIsActive, type GrainSettings } from './settings';
import { GRAIN_BLUR_WGSL, GRAIN_COMPOSITE_WGSL, GRAIN_GENERATE_WGSL } from './shaders';

const UNIFORM_FLOATS = 16;

const createPipeline = (
  device: GPUDevice,
  vertexModule: GPUShaderModule,
  fragmentCode: string
) => device.createRenderPipeline({
  layout: 'auto',
  vertex: { module: vertexModule, entryPoint: 'fullscreenVertex' },
  fragment: {
    module: device.createShaderModule({ code: `${FULLSCREEN_VERTEX_WGSL}\n${fragmentCode}` }),
    entryPoint: 'main',
    targets: [{ format: 'rgba16float' }]
  },
  primitive: { topology: 'triangle-list' }
});

export class GrainEffect implements LightTableGpuEffect<GrainSettings> {
  readonly id = 'grain';
  readonly stage = 'display-post' as const;

  private settings: GrainSettings;
  private readonly uniformBuffer: GPUBuffer;
  private readonly horizontalBuffer: GPUBuffer;
  private readonly verticalBuffer: GPUBuffer;
  private readonly vertexModule: GPUShaderModule;
  private generatePipeline: GPURenderPipeline | null = null;
  private blurPipeline: GPURenderPipeline | null = null;
  private compositePipeline: GPURenderPipeline | null = null;
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
    settings: GrainSettings
  ) {
    this.device = device;
    this.sampler = sampler;
    this.vertexModule = vertexModule;
    this.settings = cloneGrainSettings(settings);
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
    if (grainIsActive(this.settings)) this.ensureImageResources();
    else this.destroyImageResources();
    this.writeSettings();
  }

  resize(width: number, height: number) {
    this.destroyImageResources();
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    if (grainIsActive(this.settings)) this.ensureImageResources();
    this.writeSettings();
  }

  private ensureImageResources() {
    if (this.grainTexture && this.blurTexture && this.outputTexture) return;
    this.ensurePipelines();
    if (!this.blurPipeline) return;
    const createTexture = (label: string) => this.device.createTexture({
      label,
      size: [this.width, this.height],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    });
    this.grainTexture = createTexture('LightTable Grain noise');
    this.blurTexture = createTexture('LightTable Grain blur intermediate');
    this.outputTexture = createTexture('LightTable Grain output');
    this.horizontalBindGroup = this.createBlurBindGroup(this.grainTexture, this.horizontalBuffer);
    this.verticalBindGroup = this.createBlurBindGroup(this.blurTexture, this.verticalBuffer);
  }

  encode(encoder: GPUCommandEncoder, input: GPUTexture) {
    if (!grainIsActive(this.settings)) return input;
    this.ensureImageResources();
    if (!this.generatePipeline || !this.blurPipeline || !this.compositePipeline || !this.generateBindGroup ||
      !this.grainTexture || !this.blurTexture || !this.outputTexture ||
      !this.horizontalBindGroup || !this.verticalBindGroup) return input;

    this.draw(encoder, this.generatePipeline, this.generateBindGroup, this.grainTexture);
    this.draw(encoder, this.blurPipeline, this.horizontalBindGroup, this.blurTexture);
    this.draw(encoder, this.blurPipeline, this.verticalBindGroup, this.grainTexture);
    const compositeBindGroup = this.device.createBindGroup({
      layout: this.compositePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: input.createView() },
        { binding: 1, resource: this.grainTexture.createView() },
        { binding: 2, resource: { buffer: this.uniformBuffer } }
      ]
    });
    this.draw(encoder, this.compositePipeline, compositeBindGroup, this.outputTexture);
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
    this.horizontalBindGroup = null;
    this.verticalBindGroup = null;
  }

  destroy() {
    this.destroyImageResources();
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

  private createBlurBindGroup(texture: GPUTexture, direction: GPUBuffer) {
    if (!this.blurPipeline) throw new Error('LightTable Grain blur pipeline is unavailable.');
    return this.device.createBindGroup({
      layout: this.blurPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: texture.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: this.uniformBuffer } },
        { binding: 3, resource: { buffer: direction } }
      ]
    });
  }

  private ensurePipelines() {
    if (this.generatePipeline && this.blurPipeline && this.compositePipeline && this.generateBindGroup) return;
    this.generatePipeline = createPipeline(this.device, this.vertexModule, GRAIN_GENERATE_WGSL);
    this.blurPipeline = createPipeline(this.device, this.vertexModule, GRAIN_BLUR_WGSL);
    this.compositePipeline = createPipeline(this.device, this.vertexModule, GRAIN_COMPOSITE_WGSL);
    this.generateBindGroup = this.device.createBindGroup({
      layout: this.generatePipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }]
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
