import type { DepthAnalysisResult } from '../../analysis/depth/types';
import { normalizedDepthToHalf } from '../../analysis/depth/float16';
import { FULLSCREEN_VERTEX_WGSL } from '../../gpu/shaders';
import { OptionalGpuFeature } from '../../gpu/optionalGpuFeature';
import type { LightTableEffectRuntimeCallbacks, LightTableGpuEffect } from '../types';
import type { LensDistortionSettings } from '../lensDistortion/settings';
import {
  cloneLensBlurSettings,
  focusInterval,
  lensBlurIsActive,
  lensBlurQualitySampleCount,
  type LensBlurSettings
} from './settings';
import {
  LENS_BLUR_COMPOSITE_WGSL,
  LENS_BLUR_DEPTH_REFINE_WGSL,
  LENS_BLUR_DOWNSAMPLE_WGSL,
  LENS_BLUR_GATHER_WGSL
} from './shaders';

const alignTo = (value: number, alignment: number) => Math.ceil(value / alignment) * alignment;
const bokehShapeIndex = (shape: LensBlurSettings['bokehShape']) => (
  shape === 'hexagon' ? 1 : shape === 'anamorphic' ? 2 : shape === 'donut' ? 3 : 0
);

export class LensBlurEffect implements LightTableGpuEffect<LensBlurSettings> {
  readonly id = 'lens-blur';
  readonly stage = 'linear-spatial' as const;
  private readonly device: GPUDevice;
  private readonly sampler: GPUSampler;
  private readonly pipelines: OptionalGpuFeature<{
    depthRefine: GPURenderPipeline;
    downsample: GPURenderPipeline;
    gather: GPURenderPipeline;
    composite: GPURenderPipeline;
  }>;
  private readonly settingsBuffer: GPUBuffer;
  private settings: LensBlurSettings;
  private distortionSettings: LensDistortionSettings;
  private rawDepthTexture: GPUTexture | null = null;
  private refinedDepthTexture: GPUTexture | null = null;
  private halfColorTexture: GPUTexture | null = null;
  private halfDepthTexture: GPUTexture | null = null;
  private foregroundTexture: GPUTexture | null = null;
  private backgroundTexture: GPUTexture | null = null;
  private outputTexture: GPUTexture | null = null;
  private width = 1;
  private height = 1;
  private rawDepthWidth = 0;
  private rawDepthHeight = 0;
  private interactionActive = false;
  private visualizeDepth = false;

  constructor(
    device: GPUDevice,
    sampler: GPUSampler,
    vertexModule: GPUShaderModule,
    settings: LensBlurSettings,
    distortionSettings: LensDistortionSettings,
    callbacks: LightTableEffectRuntimeCallbacks = {}
  ) {
    this.device = device;
    this.sampler = sampler;
    this.settings = cloneLensBlurSettings(settings);
    this.distortionSettings = { ...distortionSettings };
    const createPipeline = (label: string, shader: string, targets: GPUColorTargetState[]) =>
      this.device.createRenderPipelineAsync({
        label,
        layout: 'auto',
        vertex: { module: vertexModule, entryPoint: 'fullscreenVertex' },
        fragment: {
          module: this.device.createShaderModule({
            label: `${label} shader`,
            code: `${FULLSCREEN_VERTEX_WGSL}\n${shader}`
          }),
          entryPoint: 'main',
          targets
        },
        primitive: { topology: 'triangle-list' }
      });
    this.pipelines = new OptionalGpuFeature({
      id: this.id,
      compile: async () => {
        const [depthRefine, downsample, gather, composite] = await Promise.all([
          createPipeline('LightTable Lens Blur depth refinement', LENS_BLUR_DEPTH_REFINE_WGSL, [{ format: 'r16float' }]),
          createPipeline('LightTable Lens Blur downsample', LENS_BLUR_DOWNSAMPLE_WGSL, [
            { format: 'rgba16float' },
            { format: 'rgba16float' }
          ]),
          createPipeline('LightTable Lens Blur aperture gather', LENS_BLUR_GATHER_WGSL, [
            { format: 'rgba16float' },
            { format: 'rgba16float' }
          ]),
          createPipeline('LightTable Lens Blur composite', LENS_BLUR_COMPOSITE_WGSL, [{ format: 'rgba16float' }])
        ]);
        return { depthRefine, downsample, gather, composite };
      },
      onReady: callbacks.requestRender,
      onError: (message) => callbacks.reportError?.(this.id, message)
    });
    this.settingsBuffer = device.createBuffer({
      label: 'LightTable Lens Blur settings',
      size: 16 * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.writeSettings();
  }

  setSettings(settings: LensBlurSettings) {
    this.settings = cloneLensBlurSettings(settings);
    if (this.rawDepthTexture && (lensBlurIsActive(this.settings) || this.visualizeDepth)) {
      void this.pipelines.ensure();
      this.ensureRenderTargets();
    }
    else this.destroyRenderTargets();
    this.writeSettings();
  }

  setDistortionSettings(settings: LensDistortionSettings) {
    this.distortionSettings = { ...settings };
    this.writeSettings();
  }

  setInteractionActive(active: boolean) {
    this.interactionActive = active;
  }

  setDepthVisualization(visualize: boolean) {
    this.visualizeDepth = visualize;
    if (this.rawDepthTexture && (lensBlurIsActive(this.settings) || visualize)) {
      void this.pipelines.ensure();
      this.ensureRenderTargets();
    }
    else this.destroyRenderTargets();
  }

  setDepthMap(depth: DepthAnalysisResult) {
    this.rawDepthTexture?.destroy();
    this.rawDepthTexture = this.device.createTexture({
      label: 'LightTable normalized relative depth',
      size: [depth.width, depth.height],
      format: 'r16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
    this.rawDepthWidth = depth.width;
    this.rawDepthHeight = depth.height;
    const halfDepth = normalizedDepthToHalf(depth.data);
    const rowBytes = depth.width * Uint16Array.BYTES_PER_ELEMENT;
    const bytesPerRow = alignTo(rowBytes, 256);
    let upload = new Uint8Array(halfDepth.buffer as ArrayBuffer);
    if (bytesPerRow !== rowBytes) {
      const padded = new Uint8Array(new ArrayBuffer(bytesPerRow * depth.height));
      const source = new Uint8Array(halfDepth.buffer, halfDepth.byteOffset, halfDepth.byteLength);
      for (let row = 0; row < depth.height; row += 1) {
        padded.set(source.subarray(row * rowBytes, (row + 1) * rowBytes), row * bytesPerRow);
      }
      upload = padded;
    }
    this.device.queue.writeTexture(
      { texture: this.rawDepthTexture },
      upload,
      { bytesPerRow, rowsPerImage: depth.height },
      { width: depth.width, height: depth.height }
    );
    if (lensBlurIsActive(this.settings) || this.visualizeDepth) {
      void this.pipelines.ensure();
      this.ensureRenderTargets();
    }
  }

  get hasDepth() {
    return this.rawDepthTexture !== null;
  }

  resize(width: number, height: number) {
    this.destroyRenderTargets();
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    if (this.rawDepthTexture && (lensBlurIsActive(this.settings) || this.visualizeDepth)) {
      this.ensureRenderTargets();
    }
    this.writeSettings();
  }

  estimatedTextureBytes() {
    const bytes = this.rawDepthTexture ? this.rawDepthWidth * this.rawDepthHeight * 2 : 0;
    if (!this.outputTexture) return bytes;
    const pixels = this.width * this.height;
    const halfPixels = Math.ceil(this.width / 2) * Math.ceil(this.height / 2);
    return bytes + pixels * 10 + halfPixels * 8 * 4;
  }

  private ensureRenderTargets() {
    if (this.outputTexture) return;
    const halfWidth = Math.max(1, Math.ceil(this.width / 2));
    const halfHeight = Math.max(1, Math.ceil(this.height / 2));
    const createTexture = (label: string, size: [number, number], format: GPUTextureFormat) => this.device.createTexture({
      label,
      size,
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    });
    this.refinedDepthTexture = createTexture('LightTable refined depth', [this.width, this.height], 'r16float');
    this.halfColorTexture = createTexture('LightTable Lens Blur half color', [halfWidth, halfHeight], 'rgba16float');
    this.halfDepthTexture = createTexture('LightTable Lens Blur half depth', [halfWidth, halfHeight], 'rgba16float');
    this.foregroundTexture = createTexture('LightTable Lens Blur foreground', [halfWidth, halfHeight], 'rgba16float');
    this.backgroundTexture = createTexture('LightTable Lens Blur background', [halfWidth, halfHeight], 'rgba16float');
    this.outputTexture = createTexture('LightTable Lens Blur linear output', [this.width, this.height], 'rgba16float');
  }

  encode(encoder: GPUCommandEncoder, input: GPUTexture) {
    if ((!lensBlurIsActive(this.settings) && !this.visualizeDepth) || !this.rawDepthTexture || !this.refinedDepthTexture ||
      !this.halfColorTexture || !this.halfDepthTexture || !this.foregroundTexture ||
      !this.backgroundTexture || !this.outputTexture) return input;
    const pipelines = this.pipelines.resource;
    if (!pipelines) {
      void this.pipelines.ensure();
      return input;
    }
    this.writeSettings();

    const depthBindGroup = this.device.createBindGroup({
      layout: pipelines.depthRefine.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: input.createView() },
        { binding: 1, resource: this.rawDepthTexture.createView() },
        { binding: 2, resource: { buffer: this.settingsBuffer } }
      ]
    });
    this.draw(encoder, pipelines.depthRefine, depthBindGroup, [this.refinedDepthTexture.createView()]);

    const downsampleBindGroup = this.device.createBindGroup({
      layout: pipelines.downsample.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: input.createView() },
        { binding: 1, resource: this.refinedDepthTexture.createView() },
        { binding: 2, resource: { buffer: this.settingsBuffer } }
      ]
    });
    this.draw(encoder, pipelines.downsample, downsampleBindGroup, [
      this.halfColorTexture.createView(),
      this.halfDepthTexture.createView()
    ]);

    const gatherBindGroup = this.device.createBindGroup({
      layout: pipelines.gather.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.halfColorTexture.createView() },
        { binding: 1, resource: this.halfDepthTexture.createView() },
        { binding: 2, resource: this.sampler },
        { binding: 3, resource: { buffer: this.settingsBuffer } }
      ]
    });
    this.draw(encoder, pipelines.gather, gatherBindGroup, [
      this.foregroundTexture.createView(),
      this.backgroundTexture.createView()
    ]);

    const compositeBindGroup = this.device.createBindGroup({
      layout: pipelines.composite.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: input.createView() },
        { binding: 1, resource: this.refinedDepthTexture.createView() },
        { binding: 2, resource: this.foregroundTexture.createView() },
        { binding: 3, resource: this.backgroundTexture.createView() },
        { binding: 4, resource: this.sampler },
        { binding: 5, resource: { buffer: this.settingsBuffer } }
      ]
    });
    this.draw(encoder, pipelines.composite, compositeBindGroup, [this.outputTexture.createView()]);
    return this.outputTexture;
  }

  destroyImageResources() {
    this.rawDepthTexture?.destroy();
    this.rawDepthTexture = null;
    this.rawDepthWidth = 0;
    this.rawDepthHeight = 0;
    this.destroyRenderTargets();
  }

  destroy() {
    this.destroyImageResources();
    this.pipelines.dispose();
    this.settingsBuffer.destroy();
  }

  private destroyRenderTargets() {
    this.refinedDepthTexture?.destroy();
    this.halfColorTexture?.destroy();
    this.halfDepthTexture?.destroy();
    this.foregroundTexture?.destroy();
    this.backgroundTexture?.destroy();
    this.outputTexture?.destroy();
    this.refinedDepthTexture = null;
    this.halfColorTexture = null;
    this.halfDepthTexture = null;
    this.foregroundTexture = null;
    this.backgroundTexture = null;
    this.outputTexture = null;
  }

  private draw(
    encoder: GPUCommandEncoder,
    pipeline: GPURenderPipeline,
    bindGroup: GPUBindGroup,
    views: GPUTextureView[],
    loadExisting = false
  ) {
    const pass = encoder.beginRenderPass({
      colorAttachments: views.map((view) => ({
        view,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: loadExisting ? 'load' as const : 'clear' as const,
        storeOp: 'store' as const
      }))
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
  }

  private writeSettings() {
    const gatherSamples = this.interactionActive ? 24 : lensBlurQualitySampleCount(this.settings.quality);
    const focus = focusInterval(this.settings);
    this.device.queue.writeBuffer(this.settingsBuffer, 0, new Float32Array([
      this.settings.apertureSize,
      this.settings.catEye,
      this.settings.bokehBoost,
      focus.start,
      focus.end,
      this.settings.transitionFeather,
      bokehShapeIndex(this.settings.bokehShape),
      this.visualizeDepth ? 1 : 0,
      this.width,
      this.height,
      this.distortionSettings.enabled ? this.distortionSettings.amount : 0,
      this.distortionSettings.midpoint,
      this.distortionSettings.zoom,
      0,
      0,
      gatherSamples
    ]));
  }
}
