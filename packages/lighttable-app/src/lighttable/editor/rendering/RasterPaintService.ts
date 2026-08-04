import { sampleGradientAsset, type GradientPaintInstance } from '@lighttable/paint-core';
import { blendModeGpuValue, type BlendMode } from '../document/blendModes';
import type { LayerId } from '../document/documentTypes';
import type { PaintChannel } from '../session/editorSession';
import type { BrushDab } from '../tools/brush/strokeBuilder';
import { invertMatrix } from '../tools/transform/affine';
import type { AffineMatrix } from '../tools/transform/transformTypes';
import { identityAffineMatrix } from './renderContract';
import type { LayerRuntimeStore } from './LayerRuntimeStore';
import type { SelectionTextureStore } from './SelectionTextureStore';
import type { ToolPipelineBundle } from './ToolPipelineBundle';

interface RasterPaintServiceOptions {
  device: GPUDevice;
  layerResources: LayerRuntimeStore;
  selectionTextures: SelectionTextureStore;
  dimensions: () => { width: number; height: number };
  pipelines: () => ToolPipelineBundle;
  ensureSelectionTargets: () => void;
  createTextureSized: (label: string, width: number, height: number) => GPUTexture;
  maskTextureFor: (layerId: LayerId) => GPUTexture | null;
  invalidateLayer: (layerId: LayerId) => void;
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
 * Encodes raster paint, fill and invert operations.
 *
 * It owns its brush-only uniform buffer lazily, keeping normal image startup
 * free from authoring allocations. Transaction/history ownership deliberately
 * remains in PixelEditHistoryService.
 */
export class RasterPaintService {
  private brushCanvasBuffer: GPUBuffer | null = null;

  constructor(private readonly options: RasterPaintServiceOptions) {}

  paintDabs(
    layerId: LayerId,
    channel: PaintChannel,
    dabs: BrushDab[],
    color: [number, number, number],
    hardness: number,
    opacity: number,
    flow: number,
    erase = false,
    transform: AffineMatrix = identityAffineMatrix()
  ) {
    if (!dabs.length) return;
    const pipelines = this.options.pipelines();
    this.options.ensureSelectionTargets();
    const runtime = this.options.layerResources.raster(layerId);
    if (channel === 'pixels' && !runtime) {
      throw new Error('The active raster layer is not available on the GPU.');
    }
    const target = channel === 'mask'
      ? this.options.maskTextureFor(layerId)
      : runtime?.texture;
    if (!target) {
      throw new Error('The active paint channel is not available on the GPU.');
    }
    const selection = this.options.selectionTextures.mask;
    if (!selection) {
      throw new Error('The LightTable selection mask is not initialized.');
    }
    const inverse = invertMatrix(transform);
    if (!inverse) {
      throw new Error('The active layer transform cannot be inverted for painting.');
    }
    const canvasBuffer = this.ensureBrushCanvasBuffer();
    const { width, height } = channel === 'pixels' && runtime
      ? runtime
      : this.options.dimensions();
    this.options.device.queue.writeBuffer(canvasBuffer, 0, new Float32Array([
      width, height, 0, 0,
      inverse.a, inverse.c, inverse.tx, 0,
      inverse.b, inverse.d, inverse.ty, 0,
      transform.a, transform.c, transform.tx, 0,
      transform.b, transform.d, transform.ty, 0
    ]));
    const luminance = color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722;
    const paintColor: [number, number, number] = channel === 'mask'
      ? [luminance, luminance, luminance]
      : color;
    const values = new Float32Array(dabs.length * 8);
    dabs.forEach((dab, index) => {
      const pressure = Math.min(1, Math.max(0.05, dab.pressure || 1));
      values.set([
        dab.x, dab.y, dab.size * (0.2 + pressure * 0.8), hardness,
        paintColor[0], paintColor[1], paintColor[2], opacity * flow * pressure
      ], index * 8);
    });
    const dabBuffer = this.options.device.createBuffer({
      label: 'LightTable brush dab batch',
      size: values.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    this.options.device.queue.writeBuffer(dabBuffer, 0, values);
    const pipeline = erase ? pipelines.erase : pipelines.brush;
    const bindGroup = this.options.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: dabBuffer } },
        { binding: 1, resource: { buffer: canvasBuffer } },
        { binding: 2, resource: selection.createView() }
      ]
    });
    const encoder = this.options.device.createCommandEncoder({
      label: 'LightTable brush dabs'
    });
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: target.createView(),
        loadOp: 'load',
        storeOp: 'store'
      }]
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(6, dabs.length);
    pass.end();
    this.options.device.queue.submit([encoder.finish()]);
    void this.options.device.queue.onSubmittedWorkDone()
      .then(() => dabBuffer.destroy());
  }

  fillColor(
    layerId: LayerId,
    channel: PaintChannel,
    color: [number, number, number],
    preserveTransparency: boolean,
    transform: AffineMatrix = identityAffineMatrix()
  ) {
    const pipelines = this.options.pipelines();
    this.options.ensureSelectionTargets();
    const runtime = this.options.layerResources.raster(layerId);
    const target = channel === 'mask'
      ? this.options.maskTextureFor(layerId)
      : runtime?.texture;
    const selection = this.options.selectionTextures.mask;
    if (!target || !selection) return false;

    const { width, height } = channel === 'pixels' && runtime
      ? runtime
      : this.options.dimensions();
    const result = this.options.createTextureSized(
      'LightTable filled layer color',
      width,
      height
    );
    const settingsBuffer = this.options.device.createBuffer({
      label: 'LightTable fill color settings',
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.options.device.queue.writeBuffer(settingsBuffer, 0, new Float32Array([
      color[0], color[1], color[2], 1,
      preserveTransparency ? 1 : 0,
      channel === 'mask' ? 1 : 0,
      0, 0,
      transform.a, transform.c, transform.tx, 0,
      transform.b, transform.d, transform.ty, 0
    ]));
    const bindGroup = this.options.device.createBindGroup({
      layout: pipelines.fillColor.getBindGroupLayout(0),
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
      pipelines.fillColor,
      bindGroup,
      result.createView(),
      { r: 0, g: 0, b: 0, a: 0 }
    );
    encoder.copyTextureToTexture(
      { texture: result },
      { texture: target },
      [width, height]
    );
    this.options.device.queue.submit([encoder.finish()]);
    this.options.invalidateLayer(layerId);
    this.options.releaseSubmittedResources();
    void this.options.device.queue.onSubmittedWorkDone().then(() => {
      result.destroy();
      settingsBuffer.destroy();
    });
    return true;
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
    this.options.ensureSelectionTargets();
    const runtime = this.options.layerResources.raster(layerId);
    const target = channel === 'mask'
      ? this.options.maskTextureFor(layerId)
      : runtime?.texture;
    const selection = this.options.selectionTextures.mask;
    const gradientInverse = invertMatrix(paint.transform);
    if (!target || !selection || !gradientInverse || paint.asset.type !== 'solid') return false;

    const pipelines = this.options.pipelines();
    const { width, height } = channel === 'pixels' && runtime
      ? runtime
      : this.options.dimensions();
    const result = this.options.createTextureSized(
      'LightTable gradient-filled layer',
      width,
      height
    );
    const settings = this.options.device.createBuffer({
      label: 'LightTable gradient fill settings',
      size: 96,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
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
    this.options.device.queue.writeBuffer(lut, 0, lutValues);
    const pipeline = pipelines.fillGradient;
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
    this.options.invalidateLayer(layerId);
    this.options.releaseSubmittedResources();
    void this.options.device.queue.onSubmittedWorkDone().then(() => {
      result.destroy();
      settings.destroy();
      lut.destroy();
    });
    return true;
  }

  invertColors(layerId: LayerId, channel: PaintChannel = 'pixels') {
    const runtime = this.options.layerResources.raster(layerId);
    const target = channel === 'mask'
      ? this.options.maskTextureFor(layerId)
      : runtime?.texture;
    if (!target) return false;
    const pipelines = this.options.pipelines();
    const { width, height } = channel === 'pixels' && runtime
      ? runtime
      : this.options.dimensions();
    const result = this.options.createTextureSized(
      'LightTable inverted layer colors',
      width,
      height
    );
    const bindGroup = this.options.device.createBindGroup({
      layout: pipelines.invertColors.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: target.createView() }]
    });
    const encoder = this.options.device.createCommandEncoder({
      label: 'LightTable invert layer colors'
    });
    this.options.drawFullscreen(
      encoder,
      pipelines.invertColors,
      bindGroup,
      result.createView(),
      { r: 0, g: 0, b: 0, a: 0 }
    );
    encoder.copyTextureToTexture(
      { texture: result },
      { texture: target },
      [width, height]
    );
    this.options.device.queue.submit([encoder.finish()]);
    this.options.invalidateLayer(layerId);
    this.options.releaseSubmittedResources();
    void this.options.device.queue.onSubmittedWorkDone()
      .then(() => result.destroy());
    return true;
  }

  destroy() {
    this.brushCanvasBuffer?.destroy();
    this.brushCanvasBuffer = null;
  }

  private ensureBrushCanvasBuffer() {
    if (!this.brushCanvasBuffer) {
      this.brushCanvasBuffer = this.options.device.createBuffer({
        label: 'LightTable brush canvas settings',
        size: 80,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      });
    }
    return this.brushCanvasBuffer;
  }
}
