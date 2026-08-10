import { sampleGradientAsset, type GradientPaintInstance } from '@lighttable/paint-core';
import { blendModeGpuValue, type BlendMode } from '../document/blendModes';
import type { LayerId, Rect } from '../document/documentTypes';
import type { PaintChannel } from '../session/editorSession';
import {
  DEFAULT_BRUSH_TIP,
  type BrushDab,
  type BrushEngine,
  type BrushTipDefinition
} from '../tools/brush/strokeBuilder';
import { invertMatrix } from '../tools/transform/affine';
import type { AffineMatrix } from '../tools/transform/transformTypes';
import { identityAffineMatrix } from './renderContract';
import type { LayerRuntimeStore } from './LayerRuntimeStore';
import type { SelectionTextureStore } from './SelectionTextureStore';
import type { BrushPipelineBundle, ToolPipelineBundle } from './ToolPipelineBundle';
import { blurBrushSourceBounds, brushHistoryRegions } from './brushHistoryRegions';
import type { SampledBrushStrokePlan } from '../tools/paint/sampledBrushTypes';

interface RasterPaintServiceOptions {
  device: GPUDevice;
  sampler: GPUSampler;
  layerResources: LayerRuntimeStore;
  selectionTextures: SelectionTextureStore;
  dimensions: () => { width: number; height: number };
  brushPipelines: () => BrushPipelineBundle;
  pipelines: () => ToolPipelineBundle;
  ensureSelectionTargets: () => void;
  createTextureSized: (label: string, width: number, height: number) => GPUTexture;
  createMaskTexture: (label: string) => GPUTexture;
  maskTextureFor: (layerId: LayerId) => GPUTexture | null;
  invalidateLayer: (layerId: LayerId) => void;
  captureHistoryRegions: (
    layerId: LayerId,
    channel: PaintChannel,
    regions: readonly Rect[]
  ) => number;
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
 * Encodes raster paint, fill and invert operations.
 *
 * It owns its brush-only uniform buffer lazily, keeping normal image startup
 * free from authoring allocations. Transaction/history ownership deliberately
 * remains in PixelEditHistoryService.
 */
export class RasterPaintService {
  private brushCanvasBuffer: GPUBuffer | null = null;
  private brushDabBuffer: { readonly buffer: GPUBuffer; readonly capacity: number } | null = null;
  private blurSource: {
    readonly layerId: LayerId;
    readonly width: number;
    readonly height: number;
    readonly texture: GPUTexture;
  } | null = null;
  private sampledSource: {
    readonly texture: GPUTexture;
    readonly width: number;
    readonly height: number;
    readonly plan: SampledBrushStrokePlan;
  } | null = null;
  private sampledSourceSettingsBuffer: GPUBuffer | null = null;

  constructor(private readonly options: RasterPaintServiceOptions) {}

  /**
   * Moves the lazy paint-only GPU setup out of the first pointer gesture.
   * This is deliberately allocation-bounded and does not encode commands,
   * capture history, invalidate a layer or modify document pixels.
   */
  prepareBrushResources() {
    this.options.brushPipelines();
    this.options.ensureSelectionTargets();
    this.ensureBrushCanvasBuffer();
  }

  beginSampledStroke(
    texture: GPUTexture,
    width: number,
    height: number,
    plan: SampledBrushStrokePlan
  ) {
    this.endSampledStroke();
    this.sampledSource = { texture, width, height, plan };
    this.sampledSourceSettingsBuffer ??= this.options.device.createBuffer({
      label: 'LightTable sampled brush source settings',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.options.device.queue.writeBuffer(
      this.sampledSourceSettingsBuffer,
      0,
      new Float32Array([width, height, plan.sourceOffset.x, plan.sourceOffset.y])
    );
  }

  endSampledStroke() {
    const source = this.sampledSource;
    this.sampledSource = null;
    if (source) {
      void this.options.device.queue.onSubmittedWorkDone().then(
        () => source.texture.destroy(),
        () => source.texture.destroy()
      );
    }
  }

  paintDabs(
    layerId: LayerId,
    channel: PaintChannel,
    dabs: BrushDab[],
    color: [number, number, number],
    hardness: number,
    opacity: number,
    flow: number,
    erase = false,
    transform: AffineMatrix = identityAffineMatrix(),
    preserveTransparency = false,
    tip: BrushTipDefinition = DEFAULT_BRUSH_TIP,
    engine: BrushEngine = 'paint',
    operator?: SampledBrushStrokePlan
  ) {
    if (!dabs.length) return;
    const pipelines = this.options.brushPipelines();
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
    if (engine === 'blur' && (channel !== 'pixels' || !runtime)) {
      throw new Error('Blur Brush requires an editable raster pixel layer.');
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
    const localRegions = brushHistoryRegions(dabs, inverse);
    this.options.captureHistoryRegions(layerId, channel, localRegions);
    const blurSourceBounds = engine === 'blur'
      ? blurBrushSourceBounds(dabs, inverse, width, height)
      : null;
    if (engine === 'blur' && !blurSourceBounds) return;
    const values = new Float32Array(dabs.length * 12);
    dabs.forEach((dab, index) => {
      const pressure = Math.min(1, Math.max(0.05, dab.pressure || 1));
      const requestedAlpha = Math.min(1, Math.max(0, opacity * flow * pressure));
      // Dense resampling removes large-tip scallops. Preserve the requested
      // flow over distance instead of making the stroke darker merely because
      // more sub-dabs were needed: N source-over samples combine as
      // 1 - (1 - alpha)^N.
      const dabAlpha = 1 - Math.pow(1 - requestedAlpha, Math.max(0, dab.flowScale));
      const seed = Math.abs(Math.sin(dab.x * 12.9898 + dab.y * 78.233) * 43758.5453) % 1;
      values.set([
        dab.x, dab.y, dab.size * (0.2 + pressure * 0.8), hardness,
        paintColor[0], paintColor[1], paintColor[2], dabAlpha,
        tip.roundness, tip.angleDegrees * Math.PI / 180, tip.roughness, seed
      ], index * 12);
    });
    const dabBuffer = this.ensureBrushDabBuffer(values.byteLength);
    this.options.device.queue.writeBuffer(dabBuffer, 0, values);
    if (operator) {
      if (channel !== 'pixels') {
        throw new Error('Sampled brushes require an editable pixel layer.');
      }
      const source = this.sampledSource;
      const settings = this.sampledSourceSettingsBuffer;
      if (!source || !settings || source.plan.operator !== operator.operator) {
        throw new Error('The sampled brush source snapshot is unavailable.');
      }
      const pipeline = operator.operator === 'clone'
        ? preserveTransparency ? pipelines.clonePreserveTransparency : pipelines.clone
        : preserveTransparency ? pipelines.healingPreserveTransparency : pipelines.healing;
      const bindGroup = this.options.device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: dabBuffer } },
          { binding: 1, resource: { buffer: canvasBuffer } },
          { binding: 2, resource: selection.createView() },
          { binding: 3, resource: source.texture.createView() },
          { binding: 4, resource: this.options.sampler },
          { binding: 5, resource: { buffer: settings } }
        ]
      });
      const encoder = this.options.device.createCommandEncoder({
        label: `LightTable ${operator.operator} brush dabs`
      });
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: target.createView(), loadOp: 'load', storeOp: 'store' }]
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(6, dabs.length);
      pass.end();
      this.options.device.queue.submit([encoder.finish()]);
      this.options.invalidateLayer(layerId);
      return;
    }
    if (engine === 'blur') {
      const source = this.ensureBlurSource(layerId, width, height);
      const pipeline = pipelines.blur;
      const bindGroup = this.options.device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: dabBuffer } },
          { binding: 1, resource: { buffer: canvasBuffer } },
          { binding: 2, resource: selection.createView() },
          { binding: 3, resource: source.createView() },
          { binding: 4, resource: this.options.sampler }
        ]
      });
      const encoder = this.options.device.createCommandEncoder({
        label: 'LightTable blur brush dabs'
      });
      encoder.copyTextureToTexture(
        { texture: target, origin: { x: blurSourceBounds!.x, y: blurSourceBounds!.y } },
        { texture: source, origin: { x: blurSourceBounds!.x, y: blurSourceBounds!.y } },
        [blurSourceBounds!.width, blurSourceBounds!.height]
      );
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: target.createView(), loadOp: 'load', storeOp: 'store' }]
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(6, dabs.length);
      pass.end();
      this.options.device.queue.submit([encoder.finish()]);
      this.options.invalidateLayer(layerId);
      return;
    }
    const pipeline = channel === 'mask'
      ? erase ? pipelines.maskErase : pipelines.maskBrush
      : preserveTransparency
        ? erase ? pipelines.erasePreserveTransparency : pipelines.brushPreserveTransparency
        : erase ? pipelines.erase : pipelines.brush;
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
    // Styled presentations cache their source pixels. Invalidate only this
    // layer so live paint remains visible while the interaction-quality cache
    // avoids recomputing unrelated layers and the full document.
    this.options.invalidateLayer(layerId);
  }

  fillColor(
    layerId: LayerId,
    channel: PaintChannel,
    color: [number, number, number],
    preserveTransparency: boolean,
    transform: AffineMatrix = identityAffineMatrix(),
    opacity = 1
  ) {
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
    const settingsBuffer = this.options.device.createBuffer({
      label: 'LightTable fill color settings',
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
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
    this.options.captureAllHistory(layerId, channel);

    const pipelines = this.options.pipelines();
    const { width, height } = channel === 'pixels' && runtime
      ? runtime
      : this.options.dimensions();
    const result = channel === 'mask'
      ? this.options.createMaskTexture('LightTable gradient-filled mask')
      : this.options.createTextureSized('LightTable gradient-filled layer', width, height);
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
    this.options.captureAllHistory(layerId, channel);
    const pipelines = this.options.pipelines();
    const { width, height } = channel === 'pixels' && runtime
      ? runtime
      : this.options.dimensions();
    const result = channel === 'mask'
      ? this.options.createMaskTexture('LightTable inverted mask')
      : this.options.createTextureSized('LightTable inverted layer colors', width, height);
    const pipeline = channel === 'mask' ? pipelines.maskInvertColors : pipelines.invertColors;
    const bindGroup = this.options.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: target.createView() }]
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
    this.brushDabBuffer?.buffer.destroy();
    this.brushDabBuffer = null;
    this.blurSource?.texture.destroy();
    this.blurSource = null;
    this.endSampledStroke();
    this.sampledSourceSettingsBuffer?.destroy();
    this.sampledSourceSettingsBuffer = null;
  }

  private ensureBlurSource(layerId: LayerId, width: number, height: number) {
    const current = this.blurSource;
    if (current && current.layerId === layerId
      && current.width === width && current.height === height) return current.texture;
    const texture = this.options.createTextureSized(
      'LightTable blur brush source snapshot', width, height
    );
    this.blurSource = { layerId, width, height, texture };
    if (current) {
      // A new stroke can target another layer while the previous queue submit
      // is still completing. Retire the old scratch only after that work is done.
      void this.options.device.queue.onSubmittedWorkDone()
        .then(() => current.texture.destroy());
    }
    return texture;
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

  private ensureBrushDabBuffer(requiredBytes: number) {
    const current = this.brushDabBuffer;
    if (current && current.capacity >= requiredBytes) return current.buffer;
    const capacity = current
      ? Math.max(requiredBytes, current.capacity * 2)
      : requiredBytes;
    const buffer = this.options.device.createBuffer({
      label: 'LightTable brush dab batches',
      size: capacity,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    this.brushDabBuffer = { buffer, capacity };
    if (current) {
      // queue.writeBuffer and submit share one ordered queue timeline. The
      // active buffer can therefore be rewritten for the next submitted
      // batch; only a replaced, smaller allocation needs deferred retirement.
      void this.options.device.queue.onSubmittedWorkDone().then(
        () => current.buffer.destroy(),
        () => current.buffer.destroy()
      );
    }
    return buffer;
  }
}
