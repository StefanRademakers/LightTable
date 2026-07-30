import { FULLSCREEN_VERTEX_WGSL } from '../../gpu/shaders';
import type { LightTableGpuEffect } from '../types';
import {
  chromaticAberrationIsActive,
  cloneChromaticAberrationSettings,
  type ChromaticAberrationSettings
} from './settings';
import { CHROMATIC_ABERRATION_WGSL } from './shaders';

export class ChromaticAberrationEffect implements LightTableGpuEffect<ChromaticAberrationSettings> {
  readonly id = 'chromatic-aberration';
  readonly stage = 'source-geometry' as const;
  private readonly device: GPUDevice;
  private readonly sampler: GPUSampler;
  private readonly vertexModule: GPUShaderModule;
  private pipeline: GPURenderPipeline | null = null;
  private readonly settingsBuffer: GPUBuffer;
  private settings: ChromaticAberrationSettings;
  private outputTexture: GPUTexture | null = null;
  private width = 1;
  private height = 1;

  constructor(device: GPUDevice, sampler: GPUSampler, vertexModule: GPUShaderModule, settings: ChromaticAberrationSettings) {
    this.device = device;
    this.sampler = sampler;
    this.vertexModule = vertexModule;
    this.settings = cloneChromaticAberrationSettings(settings);
    this.settingsBuffer = device.createBuffer({
      label: 'LightTable Chromatic Aberration settings',
      size: 8 * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.writeSettings();
  }

  setSettings(settings: ChromaticAberrationSettings) {
    this.settings = cloneChromaticAberrationSettings(settings);
    if (chromaticAberrationIsActive(this.settings)) this.ensureImageResources();
    else this.destroyImageResources();
    this.writeSettings();
  }

  resize(width: number, height: number) {
    this.destroyImageResources();
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    if (chromaticAberrationIsActive(this.settings)) this.ensureImageResources();
    this.writeSettings();
  }

  private ensureImageResources() {
    if (this.outputTexture) return;
    this.outputTexture = this.device.createTexture({
      label: 'LightTable Chromatic Aberration source output',
      size: [this.width, this.height],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    });
  }

  encode(encoder: GPUCommandEncoder, input: GPUTexture) {
    if (!chromaticAberrationIsActive(this.settings)) return input;
    this.ensureImageResources();
    this.ensurePipeline();
    if (!this.pipeline || !this.outputTexture) return input;
    const bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: input.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: this.settingsBuffer } }
      ]
    });
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.outputTexture.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store'
      }]
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    return this.outputTexture;
  }

  estimatedTextureBytes() {
    return this.outputTexture ? this.width * this.height * 8 : 0;
  }

  destroyImageResources() {
    this.outputTexture?.destroy();
    this.outputTexture = null;
  }

  destroy() {
    this.destroyImageResources();
    this.settingsBuffer.destroy();
  }

  private writeSettings() {
    this.device.queue.writeBuffer(this.settingsBuffer, 0, new Float32Array([
      this.settings.amount, this.settings.falloff, this.settings.balance, 0,
      this.width, this.height, 0, 0
    ]));
  }

  private ensurePipeline() {
    if (this.pipeline) return;
    this.pipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: this.vertexModule, entryPoint: 'fullscreenVertex' },
      fragment: {
        module: this.device.createShaderModule({ code: `${FULLSCREEN_VERTEX_WGSL}\n${CHROMATIC_ABERRATION_WGSL}` }),
        entryPoint: 'main',
        targets: [{ format: 'rgba16float' }]
      },
      primitive: { topology: 'triangle-list' }
    });
  }
}
