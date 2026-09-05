import { OptionalGpuFeature } from '../../gpu/optionalGpuFeature';
import { FULLSCREEN_VERTEX_WGSL } from '../../gpu/shaders';
import type { LightTableEffectRuntimeCallbacks, LightTableGpuEffect } from '../types';
import { cloneVignetteSettings, type VignetteSettings, vignetteIsActive } from './settings';
import { VIGNETTE_WGSL } from './shaders';

/** Ordered, layer-capable post-crop vignette operating in compositor-linear RGB. */
export class VignetteEffect implements LightTableGpuEffect<VignetteSettings> {
  readonly id = 'post-crop-vignette';
  readonly stage = 'display-post' as const;
  private readonly pipeline: OptionalGpuFeature<GPURenderPipeline>;
  private readonly settingsBuffer: GPUBuffer;
  private settings: VignetteSettings;
  private output: GPUTexture | null = null;
  private width = 1;
  private height = 1;

  constructor(
    private readonly device: GPUDevice,
    private readonly sampler: GPUSampler,
    vertexModule: GPUShaderModule,
    settings: VignetteSettings,
    callbacks: LightTableEffectRuntimeCallbacks = {}
  ) {
    this.settings = cloneVignetteSettings(settings);
    this.pipeline = new OptionalGpuFeature({
      id: this.id,
      sharedCompilation: { owner: vertexModule, key: this.id },
      compile: () => device.createRenderPipelineAsync({
        label: 'LightTable Post-crop Vignette', layout: 'auto',
        vertex: { module: vertexModule, entryPoint: 'fullscreenVertex' },
        fragment: {
          module: device.createShaderModule({
            label: 'LightTable Post-crop Vignette shader',
            code: `${FULLSCREEN_VERTEX_WGSL}\n${VIGNETTE_WGSL}`
          }),
          entryPoint: 'main', targets: [{ format: 'rgba16float' }]
        },
        primitive: { topology: 'triangle-list' }
      }),
      onReady: callbacks.requestRender,
      onError: (message) => callbacks.reportError?.(this.id, message)
    });
    this.settingsBuffer = device.createBuffer({
      label: 'LightTable Post-crop Vignette settings',
      size: 8 * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.writeSettings();
  }

  setSettings(settings: VignetteSettings) {
    this.settings = cloneVignetteSettings(settings);
    if (vignetteIsActive(settings)) void this.pipeline.ensure();
    else this.destroyImageResources();
    this.writeSettings();
  }

  resize(width: number, height: number) {
    this.destroyImageResources();
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.writeSettings();
  }

  encode(encoder: GPUCommandEncoder, input: GPUTexture): GPUTexture {
    if (!vignetteIsActive(this.settings)) return input;
    const pipeline = this.pipeline.resource;
    if (!pipeline) { void this.pipeline.ensure(); return input; }
    this.output ??= this.device.createTexture({
      label: 'LightTable Post-crop Vignette output', size: [this.width, this.height],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    });
    const bindGroup = this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: input.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: this.settingsBuffer } }
      ]
    });
    const pass = encoder.beginRenderPass({ colorAttachments: [{
      view: this.output.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 },
      loadOp: 'clear', storeOp: 'store'
    }] });
    pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup); pass.draw(3); pass.end();
    return this.output;
  }

  estimatedTextureBytes() { return this.output ? this.width * this.height * 8 : 0; }
  destroyImageResources() { this.output?.destroy(); this.output = null; }
  destroy() { this.destroyImageResources(); this.pipeline.dispose(); this.settingsBuffer.destroy(); }

  private writeSettings() {
    this.device.queue.writeBuffer(this.settingsBuffer, 0, new Float32Array([
      this.settings.amount, this.settings.midpoint, this.settings.roundness, this.settings.feather,
      this.settings.highlights, this.settings.enabled ? 1 : 0, this.width, this.height
    ]));
  }
}
