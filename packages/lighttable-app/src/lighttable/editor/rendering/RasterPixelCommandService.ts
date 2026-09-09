import { sampleGradientAsset, type GradientPaintInstance } from '@lighttable/paint-core';
import { blendModeGpuValue, type BlendMode } from '../document/blendModes';
import type { LayerId } from '../document/documentTypes';
import type { PaintChannel } from '../session/editorSession';
import { invertMatrix } from '../tools/transform/affine';
import type { AffineMatrix } from '../tools/transform/transformTypes';
import { identityAffineMatrix } from './renderContract';
import type { LayerRuntimeStore } from './LayerRuntimeStore';
import type { SelectionTextureStore } from './SelectionTextureStore';
import type { ToolPipelineBundle } from './ToolPipelineBundle';
import { releaseAfterSubmittedWork } from './SubmittedResourceRetainer';

export interface RasterPixelCommandServiceOptions {
  device: GPUDevice;
  layerResources: LayerRuntimeStore;
  selectionTextures: SelectionTextureStore;
  dimensions: () => { width: number; height: number };
  pipelines: () => ToolPipelineBundle;
  ensureSelectionTargets: () => void;
  createTextureSized: (label: string, width: number, height: number) => GPUTexture;
  createMaskTexture: (label: string) => GPUTexture;
  maskTextureFor: (layerId: LayerId) => GPUTexture | null;
  invalidateLayer: (layerId: LayerId) => void;
  captureAllHistory: (layerId: LayerId, channel: PaintChannel) => number;
  releaseSubmittedResources: () => void;
  drawFullscreen: (
    encoder: GPUCommandEncoder,
    pipeline: GPURenderPipeline,
    bindGroup: GPUBindGroup,
    target: GPUTextureView,
    clearValue: GPUColor
  ) => void;
}

/**
 * Encodes discrete, selection-clipped raster commands.
 *
 * This service owns temporary GPU resources only. The calling transaction
 * continues to own document publication, history and rollback.
 */
export class RasterPixelCommandService {
  constructor(private readonly options: RasterPixelCommandServiceOptions) {}

  private assertCommittedSelectionReadable() {
    if (this.options.selectionTextures.previewMutationActive) {
      throw new Error('The selection is still being previewed.');
    }
  }

  fillColor(
    layerId: LayerId,
    channel: PaintChannel,
    color: [number, number, number],
    preserveTransparency: boolean,
    transform: AffineMatrix = identityAffineMatrix(),
    opacity = 1
  ) {
    this.assertCommittedSelectionReadable();
    const pipelines = this.options.pipelines();
    this.options.ensureSelectionTargets();
    const runtime = this.options.layerResources.raster(layerId);
    const target = channel === 'mask'
      ? this.options.maskTextureFor(layerId)
      : runtime?.texture;
    const selection = this.options.selectionTextures.mask;
    if (!target || !selection) return false;
    this.options.captureAllHistory(layerId, channel);

    const { width, height } = channel === 'pixels' && runtime
      ? runtime
      : this.options.dimensions();
    const result = channel === 'mask'
      ? this.options.createMaskTexture('LightTable filled mask color')
      : this.options.createTextureSized('LightTable filled layer color', width, height);
    const resources: Array<{ destroy(): void }> = [result];
    let submitted = false;
    try {
      const settingsBuffer = this.options.device.createBuffer({
      label: 'LightTable fill color settings',
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      });
      resources.push(settingsBuffer);
    this.options.device.queue.writeBuffer(settingsBuffer, 0, new Float32Array([
      color[0], color[1], color[2], opacity,
      preserveTransparency ? 1 : 0,
      channel === 'mask' ? 1 : 0,
      0, 0,
      transform.a, transform.c, transform.tx, 0,
      transform.b, transform.d, transform.ty, 0
    ]));
    const bindGroup = this.options.device.createBindGroup({
      layout: (channel === 'mask' ? pipelines.maskFillColor : pipelines.fillColor).getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: target.createView() },
        { binding: 1, resource: selection.createView() },
        { binding: 2, resource: { buffer: settingsBuffer } }
      ]
    });
    const encoder = this.options.device.createCommandEncoder({
      label: 'LightTable fill layer color'
    });
    this.options.drawFullscreen(
      encoder,
      channel === 'mask' ? pipelines.maskFillColor : pipelines.fillColor,
      bindGroup,
      result.createView(),
      { r: 0, g: 0, b: 0, a: 0 }
    );
    encoder.copyTextureToTexture({ texture: result }, { texture: target }, [width, height]);
      this.options.device.queue.submit([encoder.finish()]);
      submitted = true;
      this.options.invalidateLayer(layerId);
      return true;
    } finally {
      this.release(resources, submitted);
    }
  }

  fillGradient(
    layerId: LayerId,
    channel: PaintChannel,
    paint: GradientPaintInstance,
    opacity: number,
    blendMode: BlendMode,
    preserveTransparency: boolean,
    transform: AffineMatrix = identityAffineMatrix()
  ) {
    this.assertCommittedSelectionReadable();
    this.options.ensureSelectionTargets();
    const runtime = this.options.layerResources.raster(layerId);
    const target = channel === 'mask'
      ? this.options.maskTextureFor(layerId)
      : runtime?.texture;
    const selection = this.options.selectionTextures.mask;
    const gradientInverse = invertMatrix(paint.transform);
    if (!target || !selection || !gradientInverse || paint.asset.type !== 'solid') return false;
    this.options.captureAllHistory(layerId, channel);

    const pipelines = this.options.pipelines();
    const { width, height } = channel === 'pixels' && runtime
      ? runtime
      : this.options.dimensions();
    const result = channel === 'mask'
      ? this.options.createMaskTexture('LightTable gradient-filled mask')
      : this.options.createTextureSized('LightTable gradient-filled layer', width, height);
    const resources: Array<{ destroy(): void }> = [result];
    let submitted = false;
    try {
      const settings = this.options.device.createBuffer({
      label: 'LightTable gradient fill settings',
      size: 96,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      });
      resources.push(settings);
    const shape = ({ linear: 0, radial: 1, angle: 2, reflected: 3, diamond: 4 } as const)[paint.shape];
    this.options.device.queue.writeBuffer(settings, 0, new Float32Array([
      transform.a, transform.c, transform.tx, 0,
      transform.b, transform.d, transform.ty, 0,
      gradientInverse.a, gradientInverse.c, gradientInverse.tx, 0,
      gradientInverse.b, gradientInverse.d, gradientInverse.ty, shape,
      paint.reverse ? 1 : 0, Math.min(1, Math.max(0, opacity)), paint.dither ? 1 : 0,
      blendModeGpuValue(blendMode),
      preserveTransparency ? 1 : 0, channel === 'mask' ? 1 : 0, 0, 0
    ]));
    const lutValues = new Float32Array(256 * 4);
    const linear = (value: number) => value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
    for (let index = 0; index < 256; index += 1) {
      const color = sampleGradientAsset(paint.asset, index / 255);
      lutValues.set([linear(color.r), linear(color.g), linear(color.b), color.a], index * 4);
    }
      const lut = this.options.device.createBuffer({
      label: `LightTable gradient fill LUT ${paint.asset.id}`,
      size: lutValues.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      });
      resources.push(lut);
    this.options.device.queue.writeBuffer(lut, 0, lutValues);
    const pipeline = channel === 'mask' ? pipelines.maskFillGradient : pipelines.fillGradient;
    const bindGroup = this.options.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: target.createView() },
        { binding: 1, resource: selection.createView() },
        { binding: 2, resource: { buffer: settings } },
        { binding: 3, resource: { buffer: lut } }
      ]
    });
    const encoder = this.options.device.createCommandEncoder({
      label: 'LightTable fill layer gradient'
    });
    this.options.drawFullscreen(
      encoder,
      pipeline,
      bindGroup,
      result.createView(),
      { r: 0, g: 0, b: 0, a: 0 }
    );
    encoder.copyTextureToTexture({ texture: result }, { texture: target }, [width, height]);
      this.options.device.queue.submit([encoder.finish()]);
      submitted = true;
      this.options.invalidateLayer(layerId);
      return true;
    } finally {
      this.release(resources, submitted);
    }
  }

  invertColors(
    layerId: LayerId,
    channel: PaintChannel = 'pixels',
    transform: AffineMatrix = identityAffineMatrix()
  ) {
    this.assertCommittedSelectionReadable();
    this.options.ensureSelectionTargets();
    const runtime = this.options.layerResources.raster(layerId);
    const target = channel === 'mask'
      ? this.options.maskTextureFor(layerId)
      : runtime?.texture;
    const selection = this.options.selectionTextures.mask;
    if (!target || !selection) return false;
    this.options.captureAllHistory(layerId, channel);
    const pipelines = this.options.pipelines();
    const { width, height } = channel === 'pixels' && runtime
      ? runtime
      : this.options.dimensions();
    const result = channel === 'mask'
      ? this.options.createMaskTexture('LightTable inverted mask')
      : this.options.createTextureSized('LightTable inverted layer colors', width, height);
    const resources: Array<{ destroy(): void }> = [result];
    let submitted = false;
    try {
      const pipeline = channel === 'mask' ? pipelines.maskInvertColors : pipelines.invertColors;
      const settings = this.options.device.createBuffer({
      label: 'LightTable invert colors settings',
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      });
      resources.push(settings);
    this.options.device.queue.writeBuffer(settings, 0, new Float32Array([
      transform.a, transform.c, transform.tx, channel === 'mask' ? 1 : 0,
      transform.b, transform.d, transform.ty, 0
    ]));
    const bindGroup = this.options.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: target.createView() },
        { binding: 1, resource: selection.createView() },
        { binding: 2, resource: { buffer: settings } }
      ]
    });
    const encoder = this.options.device.createCommandEncoder({
      label: 'LightTable invert layer colors'
    });
    this.options.drawFullscreen(
      encoder,
      pipeline,
      bindGroup,
      result.createView(),
      { r: 0, g: 0, b: 0, a: 0 }
    );
    encoder.copyTextureToTexture({ texture: result }, { texture: target }, [width, height]);
      this.options.device.queue.submit([encoder.finish()]);
      submitted = true;
      this.options.invalidateLayer(layerId);
      return true;
    } finally {
      this.release(resources, submitted);
    }
  }

  private release(resources: readonly { destroy(): void }[], submitted: boolean) {
    if (!submitted) {
      resources.forEach((resource) => resource.destroy());
      return;
    }
    try {
      this.options.releaseSubmittedResources();
    } finally {
      releaseAfterSubmittedWork(
        () => this.options.device.queue.onSubmittedWorkDone(),
        () => resources.forEach((resource) => resource.destroy())
      );
    }
  }
}
