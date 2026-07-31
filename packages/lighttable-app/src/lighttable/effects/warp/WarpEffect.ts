import { FULLSCREEN_VERTEX_WGSL } from '../../gpu/shaders';
import { OptionalGpuFeature } from '../../gpu/optionalGpuFeature';
import type { LightTableEffectRuntimeCallbacks, LightTableGpuEffect } from '../types';
import { WARP_FIELD_COMPUTE_WGSL, WARP_RENDER_WGSL } from './shaders';
import { createWarpGpuStamps, packWarpGpuStamps } from './warpStrokeSampling';
import type { WarpNodeSettings } from './warpTypes';

const EMPTY_STORAGE_BYTES = 32;

const borderModeIndex = (mode: WarpNodeSettings['borderMode']) => ({
  transparent: 0,
  clamp: 1,
  mirror: 2,
  'extend-edge': 1
})[mode];

export class WarpEffect implements LightTableGpuEffect<WarpNodeSettings> {
  readonly id = 'warp';
  readonly stage = 'source-geometry' as const;
  private readonly fieldPipeline: OptionalGpuFeature<GPUComputePipeline>;
  private readonly renderPipeline: OptionalGpuFeature<GPURenderPipeline>;
  private readonly fieldSettingsBuffer: GPUBuffer;
  private readonly renderSettingsBuffer: GPUBuffer;
  private settings: WarpNodeSettings;
  private width = 1;
  private height = 1;
  private displacementTexture: GPUTexture | null = null;
  private outputTexture: GPUTexture | null = null;
  private stampBuffer: GPUBuffer | null = null;
  private stampCount = 0;
  private fieldDirty = true;
  private fieldSettingsKey = '';

  constructor(
    private readonly device: GPUDevice,
    private readonly sampler: GPUSampler,
    vertexModule: GPUShaderModule,
    settings: WarpNodeSettings,
    callbacks: LightTableEffectRuntimeCallbacks = {}
  ) {
    this.settings = structuredClone(settings);
    this.fieldPipeline = new OptionalGpuFeature({
      id: 'warp-field',
      compile: () => this.device.createComputePipelineAsync({
        label: 'LightTable Warp displacement field',
        layout: 'auto',
        compute: {
          module: this.device.createShaderModule({
            label: 'LightTable Warp displacement shader',
            code: WARP_FIELD_COMPUTE_WGSL
          }),
          entryPoint: 'main'
        }
      }),
      onReady: callbacks.requestRender,
      onError: (message) => callbacks.reportError?.('warp-field', message)
    });
    this.renderPipeline = new OptionalGpuFeature({
      id: this.id,
      compile: () => this.device.createRenderPipelineAsync({
        label: 'LightTable Warp render',
        layout: 'auto',
        vertex: { module: vertexModule, entryPoint: 'fullscreenVertex' },
        fragment: {
          module: this.device.createShaderModule({
            label: 'LightTable Warp render shader',
            code: `${FULLSCREEN_VERTEX_WGSL}\n${WARP_RENDER_WGSL}`
          }),
          entryPoint: 'main',
          targets: [{ format: 'rgba16float' }]
        },
        primitive: { topology: 'triangle-list' }
      }),
      onReady: callbacks.requestRender,
      onError: (message) => callbacks.reportError?.(this.id, message)
    });
    this.fieldSettingsBuffer = device.createBuffer({
      label: 'LightTable Warp field settings',
      size: 4 * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.renderSettingsBuffer = device.createBuffer({
      label: 'LightTable Warp render settings',
      size: 4 * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.setSettings(settings);
  }

  setSettings(settings: WarpNodeSettings): void {
    const fieldSettingsKey = JSON.stringify({
      edgePinning: settings.edgePinning,
      strokes: settings.strokes
    });
    const fieldChanged = fieldSettingsKey !== this.fieldSettingsKey;
    this.settings = structuredClone(settings);
    if (fieldChanged) {
      const stamps = createWarpGpuStamps(settings.strokes);
      this.replaceStampBuffer(packWarpGpuStamps(stamps));
      this.stampCount = stamps.length;
      this.fieldDirty = true;
      this.fieldSettingsKey = fieldSettingsKey;
    }
    if (this.stampCount > 0) {
      void this.fieldPipeline.ensure();
      void this.renderPipeline.ensure();
      this.ensureImageResources();
    } else {
      this.destroyImageResources();
    }
    this.writeSettings();
  }

  resize(width: number, height: number): void {
    this.destroyImageResources();
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.fieldDirty = true;
    if (this.stampCount > 0) this.ensureImageResources();
    this.writeSettings();
  }

  encode(encoder: GPUCommandEncoder, input: GPUTexture): GPUTexture {
    if (this.stampCount === 0) return input;
    const fieldPipeline = this.fieldPipeline.resource;
    const renderPipeline = this.renderPipeline.resource;
    if (!fieldPipeline || !renderPipeline) {
      void this.fieldPipeline.ensure();
      void this.renderPipeline.ensure();
      return input;
    }
    this.ensureImageResources();
    if (!this.displacementTexture || !this.outputTexture || !this.stampBuffer) return input;

    if (this.fieldDirty) {
      const bindGroup = this.device.createBindGroup({
        layout: fieldPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.stampBuffer } },
          { binding: 1, resource: this.displacementTexture.createView() },
          { binding: 2, resource: { buffer: this.fieldSettingsBuffer } }
        ]
      });
      const pass = encoder.beginComputePass({ label: 'LightTable rebuild Warp displacement' });
      pass.setPipeline(fieldPipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.ceil(this.width / 8), Math.ceil(this.height / 8));
      pass.end();
      this.fieldDirty = false;
    }

    const bindGroup = this.device.createBindGroup({
      layout: renderPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: input.createView() },
        { binding: 1, resource: this.displacementTexture.createView() },
        { binding: 2, resource: this.sampler },
        { binding: 3, resource: { buffer: this.renderSettingsBuffer } }
      ]
    });
    const pass = encoder.beginRenderPass({
      label: 'LightTable render Warp',
      colorAttachments: [{
        view: this.outputTexture.createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store'
      }]
    });
    pass.setPipeline(renderPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    return this.outputTexture;
  }

  estimatedTextureBytes(): number {
    return this.displacementTexture && this.outputTexture
      ? this.width * this.height * 16
      : 0;
  }

  destroyImageResources(): void {
    this.displacementTexture?.destroy();
    this.outputTexture?.destroy();
    this.displacementTexture = null;
    this.outputTexture = null;
  }

  destroy(): void {
    this.destroyImageResources();
    this.stampBuffer?.destroy();
    this.stampBuffer = null;
    this.fieldPipeline.dispose();
    this.renderPipeline.dispose();
    this.fieldSettingsBuffer.destroy();
    this.renderSettingsBuffer.destroy();
  }

  private ensureImageResources(): void {
    if (this.displacementTexture && this.outputTexture) return;
    this.displacementTexture = this.device.createTexture({
      label: 'LightTable Warp displacement',
      size: [this.width, this.height],
      format: 'rgba16float',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
    });
    this.outputTexture = this.device.createTexture({
      label: 'LightTable Warp source output',
      size: [this.width, this.height],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    });
  }

  private replaceStampBuffer(packed: Float32Array): void {
    this.stampBuffer?.destroy();
    this.stampBuffer = this.device.createBuffer({
      label: 'LightTable Warp stamps',
      size: Math.max(EMPTY_STORAGE_BYTES, Math.ceil(packed.byteLength / 16) * 16),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    if (packed.byteLength > 0) {
      const upload = new Float32Array(packed);
      this.device.queue.writeBuffer(this.stampBuffer, 0, upload);
    }
  }

  private writeSettings(): void {
    const field = new ArrayBuffer(16);
    const fieldView = new DataView(field);
    fieldView.setFloat32(0, this.width, true);
    fieldView.setFloat32(4, this.height, true);
    fieldView.setUint32(8, this.stampCount, true);
    fieldView.setFloat32(12, this.settings.edgePinning, true);
    this.device.queue.writeBuffer(this.fieldSettingsBuffer, 0, field);

    const render = new ArrayBuffer(16);
    const renderView = new DataView(render);
    renderView.setFloat32(0, this.width, true);
    renderView.setFloat32(4, this.height, true);
    renderView.setFloat32(8, this.settings.opacity, true);
    renderView.setUint32(12, borderModeIndex(this.settings.borderMode), true);
    this.device.queue.writeBuffer(this.renderSettingsBuffer, 0, render);
  }
}
