import type {
  CompositeSelectionChannel,
  MagicWandOptions,
  RasterSelectionMask,
  SelectionCombineMode,
  SelectionMode,
  SelectionPoint,
  SelectionShape,
  SimilarSelectionOptions
} from '../selection/selectionTypes';
import type { SelectionTextureStore } from './SelectionTextureStore';
import type { ToolPipelineBundle } from './ToolPipelineBundle';
import { SELECTION_TEXTURE_FORMAT } from './DocumentTextureFactory';
import type { BrushDab } from '../tools/brush/strokeBuilder';
import { releaseAfterSubmittedWork } from './SubmittedResourceRetainer';

const selectionModeValue: Record<SelectionMode, number> = {
  replace: 0,
  add: 1,
  subtract: 2,
  intersect: 3,
  invert: 4,
  feather: 5,
  transform: 6,
  expand: 7,
  contract: 8,
  border: 9,
  smooth: 10
};

const SELECT_SIMILAR_GRID_SIZE = 64;

export interface SelectionShapeBuffers {
  points: Float32Array<ArrayBuffer>;
  settings: Float32Array<ArrayBuffer>;
}

export const selectionShapeBuffers = (
  shape: SelectionShape,
  width: number,
  height: number,
  antiAlias = false
): SelectionShapeBuffers | null => {
  const minimumPoints = shape.kind === 'free' || shape.kind === 'polygon' ? 3 : 2;
  if (shape.points.length < minimumPoints) return null;
  const points = new Float32Array(shape.points.length * 2);
  shape.points.forEach((point, index) => points.set([point.x, point.y], index * 2));
  const first = shape.points[0];
  const last = shape.points[shape.points.length - 1];
  return {
    points,
    settings: new Float32Array([
      width,
      height,
      shape.kind === 'rectangle' ? 0 : shape.kind === 'ellipse' ? 1 : 2,
      shape.points.length,
      first.x,
      first.y,
      last.x,
      last.y,
      antiAlias ? 1 : 0,
      0,
      0,
      0
    ])
  };
};

export const effectiveSelectionMode = (
  active: boolean,
  requestedMode: SelectionMode
): SelectionMode | null => {
  if (!active && requestedMode === 'subtract') return null;
  return active ? requestedMode : 'replace';
};

/**
 * Wide feathers run on a smaller temporary mask. The Gaussian radius remains
 * at most 32 samples there, while the final linear upscale keeps the authored
 * selection at document resolution. Small feathers stay pixel-accurate.
 */
export const selectionFeatherScale = (radius: number) =>
  Math.max(1, Math.min(8, Math.ceil(Math.max(0, radius) / 32)));

export interface SelectionFeatherPlan {
  scale: number;
  workingWidth: number;
  workingHeight: number;
  workingRadius: number;
}

export const selectionTransformUniform = (
  inverse: { a: number; b: number; c: number; d: number; tx: number; ty: number },
  width: number,
  height: number
) => new Float32Array([
  inverse.a, inverse.c, inverse.tx, 0,
  inverse.b, inverse.d, inverse.ty, 0,
  0, 0, 1, 0,
  width, height, 1, 0,
  // samplingMode is a padded vec4 in WGSL. Selection moves use linear
  // sampling so feathered and anti-aliased edges remain continuous.
  0, 0, 0, 0
]);

/**
 * Describes the symmetric working space used by both Gaussian passes. Wide
 * feathers are downsampled before either axis is blurred; mixing a full-size
 * horizontal pass with a low-resolution vertical pass produces rectangular
 * support artefacts around otherwise round selections.
 */
export const selectionFeatherPlan = (
  radius: number,
  width: number,
  height: number
): SelectionFeatherPlan => {
  const clampedRadius = Math.max(0, Math.min(250, radius));
  const scale = selectionFeatherScale(clampedRadius);
  return {
    scale,
    workingWidth: Math.max(1, Math.ceil(width / scale)),
    workingHeight: Math.max(1, Math.ceil(height / scale)),
    workingRadius: clampedRadius / scale
  };
};

interface SelectionRasterizerOptions {
  device: GPUDevice;
  sampler: GPUSampler;
  textures: SelectionTextureStore;
  dimensions: () => { width: number; height: number };
  pipelines: () => ToolPipelineBundle;
  ensureTargets: () => void;
  drawFullscreen: (
    encoder: GPUCommandEncoder,
    pipeline: GPURenderPipeline,
    bindGroup: GPUBindGroup,
    target: GPUTextureView,
    clearValue: GPUColor
  ) => void;
  clearTexture: (
    encoder: GPUCommandEncoder,
    texture: GPUTexture,
    clearValue?: GPUColor
  ) => void;
}

/**
 * Encodes the selection channel's shape, boolean, feather and clear commands.
 * The document renderer may consume the resulting textures, but it no longer
 * owns the command details or temporary-buffer lifecycle.
 */
export class SelectionRasterizer {
  private magicWandWarmup: Promise<void> | null = null;
  private magicWandLabels: GPUBuffer | null = null;
  private magicWandLabelCapacity = 0;
  private magicWandSettings: GPUBuffer | null = null;
  private magicWandReference: GPUBuffer | null = null;
  private selectSimilarColors: [GPUBuffer, GPUBuffer] | null = null;
  private selectSimilarSelectedPixelCount: GPUBuffer | null = null;
  private selectSimilarSettings: [GPUBuffer, GPUBuffer, GPUBuffer, GPUBuffer] | null = null;
  private selectionBrushDabs: GPUBuffer | null = null;
  private selectionBrushDabCapacity = 0;
  private selectionBrushCanvas: GPUBuffer | null = null;

  constructor(private readonly options: SelectionRasterizerOptions) {}

  paintBrushDabs(
    dabs: readonly BrushDab[],
    hardness: number,
    opacity: number,
    mode: 'add' | 'subtract'
  ) {
    if (!dabs.length) return true;
    const { textures, device } = this.options;
    this.options.ensureTargets();
    if (!textures.mask || (mode === 'subtract' && !textures.active)) return false;
    const hadActiveSelection = textures.active;
    const byteLength = dabs.length * 12 * Float32Array.BYTES_PER_ELEMENT;
    if (!this.selectionBrushDabs || this.selectionBrushDabCapacity < byteLength) {
      this.selectionBrushDabs?.destroy();
      this.selectionBrushDabCapacity = Math.max(byteLength, 48 * 256);
      this.selectionBrushDabs = device.createBuffer({
        label: 'LightTable Selection Brush dabs',
        size: this.selectionBrushDabCapacity,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      });
    }
    this.selectionBrushCanvas ??= device.createBuffer({
      label: 'LightTable Selection Brush canvas',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    const values = new Float32Array(dabs.length * 12);
    dabs.forEach((dab, index) => {
      const pressure = Math.min(1, Math.max(0.05, dab.pressure || 1));
      const requestedAlpha = Math.min(1, Math.max(0, opacity * pressure));
      const alpha = 1 - Math.pow(1 - requestedAlpha, Math.max(0, dab.flowScale));
      values.set([
        dab.x, dab.y, dab.size * (0.2 + pressure * 0.8), hardness,
        1, 1, 1, alpha,
        1, 0, 0, 0
      ], index * 12);
    });
    const { width, height } = this.options.dimensions();
    device.queue.writeBuffer(this.selectionBrushDabs, 0, values);
    device.queue.writeBuffer(
      this.selectionBrushCanvas,
      0,
      new Float32Array([width, height, 0, 0])
    );
    const pipeline = mode === 'subtract'
      ? this.options.pipelines().selectionBrushSubtract
      : this.options.pipelines().selectionBrushAdd;
    const bindGroup = device.createBindGroup({
      label: 'LightTable Selection Brush bindings',
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.selectionBrushDabs } },
        { binding: 1, resource: { buffer: this.selectionBrushCanvas } }
      ]
    });
    const encoder = device.createCommandEncoder({ label: 'LightTable Selection Brush dabs' });
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: textures.mask.createView(),
        loadOp: hadActiveSelection ? 'load' : 'clear',
        storeOp: 'store',
        clearValue: { r: 0, g: 0, b: 0, a: 0 }
      }]
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(6, dabs.length);
    pass.end();
    device.queue.submit([encoder.finish()]);
    textures.active = true;
    return true;
  }

  private ensureMagicWandBuffers(pixelCount: number) {
    const { device } = this.options;
    if (!this.magicWandSettings) {
      this.magicWandSettings = device.createBuffer({
        label: 'LightTable Magic Wand settings',
        size: 48,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      });
    }
    if (!this.magicWandReference) {
      this.magicWandReference = device.createBuffer({
        label: 'LightTable Magic Wand reference color',
        size: 16,
        usage: GPUBufferUsage.STORAGE
      });
    }
    if (!this.magicWandLabels || this.magicWandLabelCapacity < pixelCount) {
      this.magicWandLabels?.destroy();
      this.magicWandLabelCapacity = Math.max(pixelCount, 1);
      this.magicWandLabels = device.createBuffer({
        label: 'LightTable Magic Wand component labels',
        size: this.magicWandLabelCapacity * Uint32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.STORAGE
      });
    }
    return {
      labels: this.magicWandLabels,
      settings: this.magicWandSettings,
      reference: this.magicWandReference
    };
  }

  private ensureSelectSimilarBuffers() {
    const { device } = this.options;
    const storage = GPUBufferUsage.STORAGE;
    const uniform = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST;
    const colorBytes = SELECT_SIMILAR_GRID_SIZE ** 3 * Uint32Array.BYTES_PER_ELEMENT;
    if (!this.selectSimilarColors) this.selectSimilarColors = [0, 1].map((index) =>
      device.createBuffer({
        label: `LightTable Select Similar color grid ${index}`,
        size: colorBytes,
        usage: storage
      })) as [GPUBuffer, GPUBuffer];
    if (!this.selectSimilarSelectedPixelCount) this.selectSimilarSelectedPixelCount = device.createBuffer({
      label: 'LightTable Select Similar selected pixel count',
      size: Uint32Array.BYTES_PER_ELEMENT,
      usage: storage
    });
    if (!this.selectSimilarSettings) this.selectSimilarSettings = [0, 1, 2, 3].map((index) =>
      device.createBuffer({
        label: `LightTable Select Similar settings ${index}`,
        size: 48,
        usage: uniform
      })) as [GPUBuffer, GPUBuffer, GPUBuffer, GPUBuffer];
    return {
      colors: this.selectSimilarColors,
      selectedPixelCount: this.selectSimilarSelectedPixelCount,
      settings: this.selectSimilarSettings
    };
  }

  private combineShapeMask(
    encoder: GPUCommandEncoder,
    mode: SelectionCombineMode,
    combineBuffer: GPUBuffer
  ) {
    const { textures, device } = this.options;
    if (!textures.mask || !textures.result || !textures.shape) return false;
    const pipeline = this.options.pipelines().selectionCombine;
    device.queue.writeBuffer(
      combineBuffer,
      0,
      new Float32Array([selectionModeValue[mode], 0, 0, 0])
    );
    const bindGroup = device.createBindGroup({
      label: 'LightTable selection combine bindings',
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: textures.mask.createView() },
        { binding: 1, resource: textures.shape.createView() },
        { binding: 2, resource: { buffer: combineBuffer } }
      ]
    });
    this.options.drawFullscreen(
      encoder,
      pipeline,
      bindGroup,
      textures.result.createView(),
      { r: 0, g: 0, b: 0, a: 1 }
    );
    return true;
  }

  magicWand(
    source: GPUTexture,
    point: SelectionPoint,
    wandOptions: MagicWandOptions,
    requestedMode: SelectionCombineMode
  ) {
    this.options.ensureTargets();
    const { textures, device } = this.options;
    if (!textures.mask || !textures.result || !textures.shape) return false;
    const { width, height } = this.options.dimensions();
    if (width < 1 || height < 1) return false;
    const mode = effectiveSelectionMode(textures.active, requestedMode);
    if (!mode || mode === 'invert' || mode === 'feather' || mode === 'border'
      || mode === 'smooth' || mode === 'expand' || mode === 'contract'
      || mode === 'transform') return false;
    const seedX = Math.max(0, Math.min(width - 1, Math.floor(point.x)));
    const seedY = Math.max(0, Math.min(height - 1, Math.floor(point.y)));
    const buffers = this.ensureMagicWandBuffers(width * height);
    const settingsData = new ArrayBuffer(48);
    const settingsUint = new Uint32Array(settingsData);
    const settingsFloat = new Float32Array(settingsData);
    settingsUint.set([
      width, height, seedX, seedY,
      Math.floor((wandOptions.sampleSize - 1) / 2),
      wandOptions.contiguous ? 1 : 0,
      wandOptions.antiAlias ? 1 : 0,
      0
    ], 0);
    settingsFloat[8] = Math.max(0, Math.min(255, wandOptions.tolerance));
    device.queue.writeBuffer(buffers.settings, 0, settingsData);
    const pipelines = this.options.pipelines();
    const sampleBindings = device.createBindGroup({
      label: 'LightTable Magic Wand sample bindings',
      layout: pipelines.magicWandSample.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: source.createView() },
        { binding: 1, resource: { buffer: buffers.settings } },
        { binding: 2, resource: { buffer: buffers.reference } }
      ]
    });
    const initializeBindings = device.createBindGroup({
      label: 'LightTable Magic Wand candidate bindings',
      layout: pipelines.magicWandInitialize.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: source.createView() },
        { binding: 1, resource: { buffer: buffers.settings } },
        { binding: 2, resource: { buffer: buffers.reference } },
        { binding: 3, resource: { buffer: buffers.labels } }
      ]
    });
    const componentBindings = (pipeline: GPUComputePipeline, label: string) => device.createBindGroup({
      label,
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.settings } },
        { binding: 1, resource: { buffer: buffers.labels } }
      ]
    });
    const relaxBindings = componentBindings(
      pipelines.magicWandRelax,
      'LightTable Magic Wand relaxation bindings'
    );
    const compressBindings = componentBindings(
      pipelines.magicWandCompress,
      'LightTable Magic Wand compression bindings'
    );
    const finalBindings = device.createBindGroup({
      label: 'LightTable Magic Wand final mask bindings',
      layout: pipelines.magicWandFinal.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: source.createView() },
        { binding: 1, resource: { buffer: buffers.settings } },
        { binding: 2, resource: { buffer: buffers.reference } },
        { binding: 3, resource: { buffer: buffers.labels } }
      ]
    });
    const combineBuffer = device.createBuffer({
      label: 'LightTable Magic Wand combine settings',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    const encoder = device.createCommandEncoder({ label: 'LightTable GPU Magic Wand selection' });
    const dispatch = (
      pipeline: GPUComputePipeline,
      bindGroup: GPUBindGroup,
      x: number,
      y = 1
    ) => {
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(x, y);
      pass.end();
    };
    dispatch(pipelines.magicWandSample, sampleBindings, 1);
    const groupsX = Math.ceil(width / 8);
    const groupsY = Math.ceil(height / 8);
    dispatch(pipelines.magicWandInitialize, initializeBindings, groupsX, groupsY);
    if (wandOptions.contiguous) {
      const convergencePasses = Math.ceil(Math.log2(Math.max(1, width * height))) + 4;
      for (let iteration = 0; iteration < convergencePasses; iteration += 1) {
        dispatch(pipelines.magicWandRelax, relaxBindings, groupsX, groupsY);
        dispatch(pipelines.magicWandCompress, compressBindings, groupsX, groupsY);
      }
    }
    this.options.drawFullscreen(
      encoder,
      pipelines.magicWandFinal,
      finalBindings,
      textures.shape.createView(),
      { r: 0, g: 0, b: 0, a: 1 }
    );
    if (!this.combineShapeMask(encoder, mode, combineBuffer)) {
      combineBuffer.destroy();
      return false;
    }
    device.queue.submit([encoder.finish()]);
    textures.swapMaskAndResult();
    textures.active = true;
    releaseAfterSubmittedWork(() => device.queue.onSubmittedWorkDone(), () => combineBuffer.destroy());
    return true;
  }

  selectSimilar(source: GPUTexture, similarOptions: SimilarSelectionOptions) {
    this.options.ensureTargets();
    const { textures, device } = this.options;
    if (!textures.active || !textures.mask || !textures.result || !textures.shape) return false;
    const { width, height } = this.options.dimensions();
    if (width < 1 || height < 1) return false;
    const resources = this.ensureSelectSimilarBuffers();
    const tolerance = Math.max(0, Math.min(255, similarOptions.tolerance));
    const radius = Math.min(
      SELECT_SIMILAR_GRID_SIZE - 1,
      Math.round(tolerance / 255 * (SELECT_SIMILAR_GRID_SIZE - 1))
    );
    resources.settings.forEach((buffer, index) => {
      const data = new ArrayBuffer(48);
      new Uint32Array(data).set([
        width,
        height,
        SELECT_SIMILAR_GRID_SIZE,
        Math.max(0, index - 1),
        radius,
        similarOptions.antiAlias ? 1 : 0,
        0,
        0
      ]);
      new Float32Array(data)[8] = tolerance;
      device.queue.writeBuffer(buffer, 0, data);
    });
    const pipelines = this.options.pipelines();
    const clearBindings = device.createBindGroup({
      label: 'LightTable Select Similar clear bindings',
      layout: pipelines.selectSimilarClear.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: resources.settings[0] } },
        { binding: 1, resource: { buffer: resources.colors[0] } },
        { binding: 2, resource: { buffer: resources.selectedPixelCount } }
      ]
    });
    const markBindings = device.createBindGroup({
      label: 'LightTable Select Similar mark bindings',
      layout: pipelines.selectSimilarMark.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: source.createView() },
        { binding: 1, resource: textures.mask.createView() },
        { binding: 2, resource: { buffer: resources.settings[0] } },
        { binding: 3, resource: { buffer: resources.colors[0] } },
        { binding: 4, resource: { buffer: resources.selectedPixelCount } }
      ]
    });
    const dilationBindings = [0, 1, 2].map((axis) => {
      const input = axis % 2;
      const output = 1 - input;
      return device.createBindGroup({
        label: `LightTable Select Similar tolerance axis ${axis}`,
        layout: pipelines.selectSimilarDilate.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: resources.settings[axis + 1] } },
          { binding: 1, resource: { buffer: resources.colors[input] } },
          { binding: 2, resource: { buffer: resources.colors[output] } }
        ]
      });
    });
    const finalBindings = device.createBindGroup({
      label: 'LightTable Select Similar final bindings',
      layout: pipelines.selectSimilarFinal.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: source.createView() },
        { binding: 1, resource: { buffer: resources.settings[0] } },
        { binding: 2, resource: { buffer: resources.colors[1] } },
        { binding: 3, resource: { buffer: resources.selectedPixelCount } }
      ]
    });
    const combineBuffer = device.createBuffer({
      label: 'LightTable Select Similar combine settings',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    const encoder = device.createCommandEncoder({ label: 'LightTable GPU Select Similar' });
    const dispatch = (pipeline: GPUComputePipeline, bindings: GPUBindGroup, x: number, y = 1) => {
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindings);
      pass.dispatchWorkgroups(x, y);
      pass.end();
    };
    const gridCells = SELECT_SIMILAR_GRID_SIZE ** 3;
    dispatch(pipelines.selectSimilarClear, clearBindings, Math.ceil(gridCells / 256));
    dispatch(pipelines.selectSimilarMark, markBindings, Math.ceil(width / 8), Math.ceil(height / 8));
    dilationBindings.forEach((bindings) =>
      dispatch(pipelines.selectSimilarDilate, bindings, Math.ceil(gridCells / 256)));
    this.options.drawFullscreen(
      encoder,
      pipelines.selectSimilarFinal,
      finalBindings,
      textures.shape.createView(),
      { r: 0, g: 0, b: 0, a: 1 }
    );
    if (!this.combineShapeMask(encoder, 'add', combineBuffer)) {
      combineBuffer.destroy();
      return false;
    }
    device.queue.submit([encoder.finish()]);
    textures.swapMaskAndResult();
    textures.active = true;
    releaseAfterSubmittedWork(() => device.queue.onSubmittedWorkDone(), () => combineBuffer.destroy());
    return true;
  }

  /**
   * Compiles every Magic Wand pipeline against isolated 1×1 resources.
   * No document texture or selection mask is touched, so tool activation can
   * hide Dawn's lazy shader compilation without creating history or dirtiness.
   */
  prepareMagicWand() {
    if (this.magicWandWarmup) return this.magicWandWarmup;
    const { device } = this.options;
    const pipelines = this.options.pipelines();
    const source = device.createTexture({
      label: 'LightTable Magic Wand warmup source',
      size: [1, 1],
      format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING
    });
    const target = device.createTexture({
      label: 'LightTable Magic Wand warmup target',
      size: [1, 1],
      format: SELECTION_TEXTURE_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT
    });
    const settings = device.createBuffer({
      label: 'LightTable Magic Wand warmup settings',
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    const reference = device.createBuffer({
      label: 'LightTable Magic Wand warmup reference',
      size: 16,
      usage: GPUBufferUsage.STORAGE
    });
    const labels = device.createBuffer({
      label: 'LightTable Magic Wand warmup labels',
      size: 4,
      usage: GPUBufferUsage.STORAGE
    });
    const settingsData = new ArrayBuffer(48);
    new Uint32Array(settingsData).set([1, 1, 0, 0, 0, 1, 1, 0], 0);
    new Float32Array(settingsData)[8] = 20;
    device.queue.writeBuffer(settings, 0, settingsData);
    const sample = device.createBindGroup({
      layout: pipelines.magicWandSample.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: source.createView() },
        { binding: 1, resource: { buffer: settings } },
        { binding: 2, resource: { buffer: reference } }
      ]
    });
    const initialize = device.createBindGroup({
      layout: pipelines.magicWandInitialize.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: source.createView() },
        { binding: 1, resource: { buffer: settings } },
        { binding: 2, resource: { buffer: reference } },
        { binding: 3, resource: { buffer: labels } }
      ]
    });
    const componentBindings = (pipeline: GPUComputePipeline) => device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: settings } },
        { binding: 1, resource: { buffer: labels } }
      ]
    });
    const relax = componentBindings(pipelines.magicWandRelax);
    const compress = componentBindings(pipelines.magicWandCompress);
    const final = device.createBindGroup({
      layout: pipelines.magicWandFinal.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: source.createView() },
        { binding: 1, resource: { buffer: settings } },
        { binding: 2, resource: { buffer: reference } },
        { binding: 3, resource: { buffer: labels } }
      ]
    });
    const encoder = device.createCommandEncoder({ label: 'LightTable Magic Wand pipeline warmup' });
    for (const [pipeline, bindings] of [
      [pipelines.magicWandSample, sample],
      [pipelines.magicWandInitialize, initialize],
      [pipelines.magicWandRelax, relax],
      [pipelines.magicWandCompress, compress]
    ] as const) {
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindings);
      pass.dispatchWorkgroups(1);
      pass.end();
    }
    this.options.drawFullscreen(
      encoder,
      pipelines.magicWandFinal,
      final,
      target.createView(),
      { r: 0, g: 0, b: 0, a: 1 }
    );
    device.queue.submit([encoder.finish()]);
    this.magicWandWarmup = device.queue.onSubmittedWorkDone().then(() => {
      source.destroy();
      target.destroy();
      settings.destroy();
      reference.destroy();
      labels.destroy();
    }, (reason) => {
      source.destroy();
      target.destroy();
      settings.destroy();
      reference.destroy();
      labels.destroy();
      this.magicWandWarmup = null;
      throw reason;
    });
    return this.magicWandWarmup;
  }

  private copyRedChannel(
    source: GPUTexture,
    target: GPUTexture,
    pipeline: GPURenderPipeline,
    label: string
  ) {
    const { device } = this.options;
    const bindGroup = device.createBindGroup({
      label: `${label} bindings`,
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: source.createView() }]
    });
    const encoder = device.createCommandEncoder({ label });
    this.options.drawFullscreen(
      encoder,
      pipeline,
      bindGroup,
      target.createView(),
      { r: 0, g: 0, b: 0, a: 1 }
    );
    device.queue.submit([encoder.finish()]);
  }

  copySelectionToMask(target: GPUTexture) {
    this.options.ensureTargets();
    const { textures } = this.options;
    if (!textures.active || !textures.mask) return false;
    this.copyRedChannel(
      textures.mask,
      target,
      this.options.pipelines().coverageCopy,
      'LightTable bake selection into layer mask'
    );
    return true;
  }

  /** Writes an inference alpha directly into a document-owned layer mask.
   * This deliberately leaves the user's live selection untouched. */
  applyLayerMask(
    target: GPUTexture,
    mask: RasterSelectionMask,
    mode: 'replace' | 'intersect'
  ) {
    const { device } = this.options;
    const dimensions = this.options.dimensions();
    if (mask.width !== dimensions.width || mask.height !== dimensions.height
      || mask.data.byteLength !== mask.width * mask.height) return false;

    const incoming = device.createTexture({
      label: 'LightTable generated layer mask',
      size: [mask.width, mask.height],
      format: 'r8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
    const createCoverage = (label: string) => device.createTexture({
      label,
      size: [mask.width, mask.height],
      format: SELECTION_TEXTURE_FORMAT,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT
    });
    device.queue.writeTexture(
      { texture: incoming }, mask.data,
      { bytesPerRow: mask.width, rowsPerImage: mask.height },
      { width: mask.width, height: mask.height }
    );
    if (mode === 'replace') {
      this.copyRedChannel(
        incoming,
        target,
        this.options.pipelines().coverageCopy,
        'LightTable replace generated layer mask'
      );
      releaseAfterSubmittedWork(() => device.queue.onSubmittedWorkDone(), () => incoming.destroy());
      return true;
    }

    const current = createCoverage('LightTable current layer mask work texture');
    const result = createCoverage('LightTable intersected layer mask work texture');
    this.copyRedChannel(
      target,
      current,
      this.options.pipelines().coverageCopy,
      'LightTable read current layer mask'
    );
    const settings = device.createBuffer({
      label: 'LightTable generated layer mask combine settings',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(settings, 0, new Float32Array([2, 0, 0, 0]));
    const pipeline = this.options.pipelines().selectionCombine;
    const bindGroup = device.createBindGroup({
      label: 'LightTable generated layer mask combine bindings',
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: current.createView() },
        { binding: 1, resource: incoming.createView() },
        { binding: 2, resource: { buffer: settings } }
      ]
    });
    const encoder = device.createCommandEncoder({ label: 'LightTable intersect generated layer mask' });
    this.options.drawFullscreen(
      encoder, pipeline, bindGroup, result.createView(),
      { r: 0, g: 0, b: 0, a: 1 }
    );
    device.queue.submit([encoder.finish()]);
    this.copyRedChannel(
      result,
      target,
      this.options.pipelines().coverageCopy,
      'LightTable store intersected layer mask'
    );
    releaseAfterSubmittedWork(() => device.queue.onSubmittedWorkDone(), () => {
      incoming.destroy(); current.destroy(); result.destroy(); settings.destroy();
    });
    return true;
  }

  loadMask(source: GPUTexture) {
    this.options.ensureTargets();
    const { textures } = this.options;
    if (!textures.mask) return false;
    this.copyRedChannel(
      source,
      textures.mask,
      this.options.pipelines().coverageCopy,
      'LightTable load layer mask as selection'
    );
    textures.active = true;
    return true;
  }

  /** Loads intrinsic pixel transparency. This must never derive coverage from
   * RGB or composite luminance: opaque black and opaque white are equally
   * selected, while only source alpha controls partial coverage. */
  loadTransparency(source: GPUTexture) {
    return this.loadTextureChannel(source, 4, 'LightTable load layer alpha as selection');
  }

  loadColorChannel(source: GPUTexture, channel: CompositeSelectionChannel) {
    return this.loadTextureChannel(
      source,
      channel === 'red' ? 0 : channel === 'green' ? 1 : channel === 'blue' ? 2 : 3,
      'LightTable load composite channel as selection'
    );
  }

  private loadTextureChannel(source: GPUTexture, channel: number, label: string) {
    this.options.ensureTargets();
    const { textures, device } = this.options;
    if (!textures.mask) return false;
    const pipeline = this.options.pipelines().channelToSelection;
    const settings = device.createBuffer({
      label: `${label} settings`,
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(settings, 0, new Uint32Array([
      channel,
      0,
      0,
      0
    ]));
    const bindGroup = device.createBindGroup({
      label: `${label} bindings`,
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: source.createView() },
        { binding: 1, resource: { buffer: settings } }
      ]
    });
    const encoder = device.createCommandEncoder({ label });
    this.options.drawFullscreen(
      encoder,
      pipeline,
      bindGroup,
      textures.mask.createView(),
      { r: 0, g: 0, b: 0, a: 1 }
    );
    device.queue.submit([encoder.finish()]);
    textures.active = true;
    releaseAfterSubmittedWork(() => device.queue.onSubmittedWorkDone(), () => settings.destroy());
    return true;
  }

  applyRasterMask(mask: RasterSelectionMask, requestedMode: SelectionCombineMode) {
    this.options.ensureTargets();
    const { textures, device } = this.options;
    const dimensions = this.options.dimensions();
    if (!textures.mask || !textures.result || !textures.shape
      || mask.width !== dimensions.width || mask.height !== dimensions.height
      || mask.data.byteLength !== mask.width * mask.height) return false;
    const mode = effectiveSelectionMode(textures.active, requestedMode);
    if (!mode || mode === 'invert' || mode === 'feather' || mode === 'border'
      || mode === 'smooth' || mode === 'expand' || mode === 'contract'
      || mode === 'transform') return false;

    const incoming = device.createTexture({
      label: 'LightTable raster selection byte mask',
      size: [mask.width, mask.height],
      format: 'r8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
    device.queue.writeTexture(
      { texture: incoming },
      mask.data,
      { bytesPerRow: mask.width, rowsPerImage: mask.height },
      { width: mask.width, height: mask.height }
    );
    const combineBuffer = device.createBuffer({
      label: 'LightTable raster selection combine settings',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    const encoder = device.createCommandEncoder({ label: 'LightTable apply raster selection mask' });
    const uploadPipeline = this.options.pipelines().coverageCopy;
    const uploadBindings = device.createBindGroup({
      label: 'LightTable raster selection upload bindings',
      layout: uploadPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: incoming.createView() }]
    });
    this.options.drawFullscreen(
      encoder,
      uploadPipeline,
      uploadBindings,
      textures.shape.createView(),
      { r: 0, g: 0, b: 0, a: 1 }
    );
    if (!this.combineShapeMask(encoder, mode, combineBuffer)) {
      incoming.destroy();
      combineBuffer.destroy();
      return false;
    }
    device.queue.submit([encoder.finish()]);
    textures.swapMaskAndResult();
    textures.active = true;
    releaseAfterSubmittedWork(() => device.queue.onSubmittedWorkDone(), () => {
      incoming.destroy();
      combineBuffer.destroy();
    });
    return true;
  }

  private encodeFeather(
    encoder: GPUCommandEncoder,
    source: GPUTexture,
    intermediate: GPUTexture,
    target: GPUTexture,
    radius: number,
    applyAtCanvasBounds: boolean,
    submittedBuffers: GPUBuffer[],
    submittedTextures: GPUTexture[]
  ) {
    const { device, sampler } = this.options;
    const { width, height } = this.options.dimensions();
    const pipeline = this.options.pipelines().selectionFeather;
    const plan = selectionFeatherPlan(radius, width, height);
    const { scale, workingWidth: featherWidth, workingHeight: featherHeight } = plan;
    const temporaryTextures = scale === 1 ? [] : [
      device.createTexture({
        label: 'LightTable feather selection low-resolution source',
        size: { width: featherWidth, height: featherHeight },
        format: SELECTION_TEXTURE_FORMAT,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT
      }),
      device.createTexture({
        label: 'LightTable feather selection low-resolution horizontal',
        size: { width: featherWidth, height: featherHeight },
        format: SELECTION_TEXTURE_FORMAT,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT
      }),
      device.createTexture({
        label: 'LightTable feather selection low-resolution vertical',
        size: { width: featherWidth, height: featherHeight },
        format: SELECTION_TEXTURE_FORMAT,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT
      })
    ];
    submittedTextures.push(...temporaryTextures);
    const encodePass = (
      label: string,
      direction: [number, number],
      passSource: GPUTexture,
      passTarget: GPUTexture,
      sourceWidth: number,
      sourceHeight: number,
      passRadius: number
    ) => {
      const settingsBuffer = device.createBuffer({
        label: `${label} settings`,
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      });
      device.queue.writeBuffer(settingsBuffer, 0, new Float32Array([
        sourceWidth, sourceHeight, direction[0], direction[1], passRadius,
        applyAtCanvasBounds ? 1 : 0, 0, 0
      ]));
      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: passSource.createView() },
          { binding: 1, resource: sampler },
          { binding: 2, resource: { buffer: settingsBuffer } }
        ]
      });
      this.options.drawFullscreen(
        encoder,
        pipeline,
        bindGroup,
        passTarget.createView(),
        { r: 0, g: 0, b: 0, a: 1 }
      );
      submittedBuffers.push(settingsBuffer);
    };
    let horizontalSource = source;
    let horizontalTarget = intermediate;
    let verticalTarget = target;
    if (scale > 1) {
      const resamplePipeline = this.options.pipelines().selectionResample;
      const downsampleBindGroup = device.createBindGroup({
        label: 'LightTable feather selection downsample bindings',
        layout: resamplePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: source.createView() },
          { binding: 1, resource: sampler }
        ]
      });
      this.options.drawFullscreen(
        encoder,
        resamplePipeline,
        downsampleBindGroup,
        temporaryTextures[0].createView(),
        { r: 0, g: 0, b: 0, a: 1 }
      );
      horizontalSource = temporaryTextures[0];
      horizontalTarget = temporaryTextures[1];
      verticalTarget = temporaryTextures[2];
    }
    encodePass(
      'LightTable feather selection horizontal',
      [1, 0],
      horizontalSource,
      horizontalTarget,
      featherWidth,
      featherHeight,
      plan.workingRadius
    );
    encodePass(
      'LightTable feather selection vertical',
      [0, 1],
      horizontalTarget,
      verticalTarget,
      featherWidth,
      featherHeight,
      plan.workingRadius
    );
    if (scale > 1) {
      const resamplePipeline = this.options.pipelines().selectionResample;
      const resampleBindGroup = device.createBindGroup({
        label: 'LightTable feather selection upscale bindings',
        layout: resamplePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: verticalTarget.createView() },
          { binding: 1, resource: sampler }
        ]
      });
      this.options.drawFullscreen(
        encoder,
        resamplePipeline,
        resampleBindGroup,
        target.createView(),
        { r: 0, g: 0, b: 0, a: 1 }
      );
    }
  }

  set(
    shape: SelectionShape,
    requestedMode: SelectionMode,
    featherRadius = 0,
    antiAlias = false
  ) {
    this.options.ensureTargets();
    const { textures, device } = this.options;
    if (!textures.mask || !textures.result || !textures.shape) return false;
    const { width, height } = this.options.dimensions();
    const shapeData = selectionShapeBuffers(shape, width, height, antiAlias);
    const mode = effectiveSelectionMode(textures.active, requestedMode);
    if (!shapeData || !mode) return false;
    const pipelines = this.options.pipelines();
    const pointBuffer = device.createBuffer({
      label: 'LightTable selection points',
      size: Math.max(8, shapeData.points.byteLength),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(pointBuffer, 0, shapeData.points);
    const shapeBuffer = device.createBuffer({
      label: 'LightTable selection shape settings',
      size: shapeData.settings.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(shapeBuffer, 0, shapeData.settings);
    const combineBuffer = device.createBuffer({
      label: 'LightTable selection combine settings',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(
      combineBuffer,
      0,
      new Float32Array([selectionModeValue[mode], 0, 0, 0])
    );
    const shapeBindGroup = device.createBindGroup({
      layout: pipelines.selectionShape.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: shapeBuffer } },
        { binding: 1, resource: { buffer: pointBuffer } }
      ]
    });
    const combineBindGroup = device.createBindGroup({
      layout: pipelines.selectionCombine.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: textures.mask.createView() },
        { binding: 1, resource: textures.shape.createView() },
        { binding: 2, resource: { buffer: combineBuffer } }
      ]
    });
    const encoder = device.createCommandEncoder({
      label: 'LightTable rasterize and combine selection shape'
    });
    this.options.drawFullscreen(
      encoder,
      pipelines.selectionShape,
      shapeBindGroup,
      textures.shape.createView(),
      { r: 0, g: 0, b: 0, a: 1 }
    );
    const submittedBuffers: GPUBuffer[] = [];
    const submittedTextures: GPUTexture[] = [];
    const clampedFeatherRadius = Math.max(0, Math.min(250, featherRadius));
    if (clampedFeatherRadius > 0) {
      this.encodeFeather(
        encoder,
        textures.shape,
        textures.result,
        textures.shape,
        clampedFeatherRadius,
        false,
        submittedBuffers,
        submittedTextures
      );
    }
    this.options.drawFullscreen(
      encoder,
      pipelines.selectionCombine,
      combineBindGroup,
      textures.result.createView(),
      { r: 0, g: 0, b: 0, a: 1 }
    );
    device.queue.submit([encoder.finish()]);
    textures.swapMaskAndResult();
    textures.active = true;
    releaseAfterSubmittedWork(() => device.queue.onSubmittedWorkDone(), () => {
      pointBuffer.destroy();
      shapeBuffer.destroy();
      combineBuffer.destroy();
      submittedBuffers.forEach((buffer) => buffer.destroy());
      submittedTextures.forEach((texture) => texture.destroy());
    });
    return true;
  }

  destroy() {
    this.magicWandLabels?.destroy();
    this.magicWandSettings?.destroy();
    this.magicWandReference?.destroy();
    this.selectionBrushDabs?.destroy();
    this.selectionBrushCanvas?.destroy();
    this.selectSimilarColors?.forEach((buffer) => buffer.destroy());
    this.selectSimilarSelectedPixelCount?.destroy();
    this.selectSimilarSettings?.forEach((buffer) => buffer.destroy());
    this.magicWandLabels = null;
    this.magicWandSettings = null;
    this.magicWandReference = null;
    this.selectionBrushDabs = null;
    this.selectionBrushCanvas = null;
    this.selectionBrushDabCapacity = 0;
    this.selectSimilarColors = null;
    this.selectSimilarSelectedPixelCount = null;
    this.selectSimilarSettings = null;
    this.magicWandLabelCapacity = 0;
  }

  transform(matrix: { a: number; b: number; c: number; d: number; tx: number; ty: number }) {
    const { textures, device, sampler } = this.options;
    if (!textures.active || !textures.mask || !textures.result) return false;
    const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
    if (Math.abs(determinant) < 1e-8) return false;
    const inverse = {
      a: matrix.d / determinant,
      b: -matrix.b / determinant,
      c: -matrix.c / determinant,
      d: matrix.a / determinant,
      tx: (matrix.c * matrix.ty - matrix.d * matrix.tx) / determinant,
      ty: (matrix.b * matrix.tx - matrix.a * matrix.ty) / determinant
    };
    const { width, height } = this.options.dimensions();
    const settings = device.createBuffer({
      label: 'LightTable selection transform settings',
      size: 80,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(settings, 0, selectionTransformUniform(inverse, width, height));
    const pipeline = this.options.pipelines().selectionTransform;
    const bindGroup = device.createBindGroup({
      label: 'LightTable selection transform bindings',
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: textures.mask.createView() },
        { binding: 1, resource: sampler },
        { binding: 2, resource: { buffer: settings } }
      ]
    });
    const encoder = device.createCommandEncoder({ label: 'LightTable transform selection' });
    this.options.drawFullscreen(
      encoder,
      pipeline,
      bindGroup,
      textures.result.createView(),
      { r: 0, g: 0, b: 0, a: 1 }
    );
    device.queue.submit([encoder.finish()]);
    textures.swapMaskAndResult();
    releaseAfterSubmittedWork(() => device.queue.onSubmittedWorkDone(), () => settings.destroy());
    return true;
  }

  feather(radius: number, applyAtCanvasBounds: boolean) {
    const { textures, device } = this.options;
    if (!textures.active || !textures.mask || !textures.result) return false;
    const clampedRadius = Math.max(0, Math.min(250, radius));
    if (clampedRadius <= 0) return true;
    const encoder = device.createCommandEncoder({
      label: 'LightTable high-quality selection feather'
    });
    const submittedBuffers: GPUBuffer[] = [];
    const temporaryTextures: GPUTexture[] = [];
    this.encodeFeather(
      encoder,
      textures.mask,
      textures.result,
      textures.mask,
      clampedRadius,
      applyAtCanvasBounds,
      submittedBuffers,
      temporaryTextures
    );
    device.queue.submit([encoder.finish()]);
    releaseAfterSubmittedWork(() => device.queue.onSubmittedWorkDone(), () => {
      submittedBuffers.forEach((buffer) => buffer.destroy());
      temporaryTextures.forEach((texture) => texture.destroy());
    });
    return true;
  }

  morphology(
    mode: 'expand' | 'contract',
    radius: number,
    applyAtCanvasBounds: boolean
  ) {
    const { textures, device } = this.options;
    if (!textures.active || !textures.mask || !textures.result || !textures.shape) return false;
    const clampedRadius = Math.max(1, Math.min(500, Math.round(radius)));
    const encoder = device.createCommandEncoder({ label: `LightTable ${mode} selection` });
    const buffers: GPUBuffer[] = [];
    this.encodeMorphology(
      encoder,
      textures.mask,
      textures.result,
      textures.shape,
      mode,
      clampedRadius,
      applyAtCanvasBounds,
      buffers
    );
    device.queue.submit([encoder.finish()]);
    textures.swapMaskAndResult();
    releaseAfterSubmittedWork(
      () => device.queue.onSubmittedWorkDone(),
      () => buffers.forEach((buffer) => buffer.destroy())
    );
    return true;
  }

  smooth(radius: number, applyAtCanvasBounds: boolean) {
    const { textures, device } = this.options;
    if (!textures.active || !textures.mask || !textures.result || !textures.shape) return false;
    const normalized = Math.max(1, Math.min(100, Math.round(radius)));
    const { width, height } = this.options.dimensions();
    const horizontal = device.createTexture({
      label: 'LightTable selection smooth horizontal average',
      size: { width, height },
      format: 'r32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING
    });
    const coverage = device.createTexture({
      label: 'LightTable selection smooth coverage',
      size: { width, height },
      format: 'r32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING
    });
    const settings = device.createBuffer({
      label: 'LightTable smooth selection settings',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(settings, 0, new Int32Array([
      width,
      height,
      normalized,
      applyAtCanvasBounds ? 1 : 0
    ]));
    const encoder = device.createCommandEncoder({ label: 'LightTable smooth selection' });
    const horizontalPipeline = this.options.pipelines().selectionSmoothHorizontal;
    const horizontalPass = encoder.beginComputePass({ label: 'LightTable smooth selection horizontal' });
    horizontalPass.setPipeline(horizontalPipeline);
    horizontalPass.setBindGroup(0, device.createBindGroup({
      label: 'LightTable smooth selection horizontal bindings',
      layout: horizontalPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: textures.mask.createView() },
        { binding: 1, resource: horizontal.createView() },
        { binding: 2, resource: { buffer: settings } }
      ]
    }));
    horizontalPass.dispatchWorkgroups(Math.ceil(height / 64));
    horizontalPass.end();
    const verticalPipeline = this.options.pipelines().selectionSmoothVertical;
    const verticalPass = encoder.beginComputePass({ label: 'LightTable smooth selection vertical' });
    verticalPass.setPipeline(verticalPipeline);
    verticalPass.setBindGroup(0, device.createBindGroup({
      label: 'LightTable smooth selection vertical bindings',
      layout: verticalPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: horizontal.createView() },
        { binding: 1, resource: coverage.createView() },
        { binding: 2, resource: { buffer: settings } }
      ]
    }));
    verticalPass.dispatchWorkgroups(Math.ceil(width / 64));
    verticalPass.end();
    const pipeline = this.options.pipelines().selectionSmoothThreshold;
    const bindGroup = device.createBindGroup({
      label: 'LightTable smooth selection threshold bindings',
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: coverage.createView() }]
    });
    this.options.drawFullscreen(
      encoder,
      pipeline,
      bindGroup,
      textures.result.createView(),
      { r: 0, g: 0, b: 0, a: 1 }
    );
    device.queue.submit([encoder.finish()]);
    textures.swapMaskAndResult();
    releaseAfterSubmittedWork(() => device.queue.onSubmittedWorkDone(), () => {
      settings.destroy();
      horizontal.destroy();
      coverage.destroy();
    });
    return true;
  }

  border(width: number) {
    const { textures, device } = this.options;
    if (!textures.active || !textures.mask || !textures.result || !textures.shape) return false;
    const borderWidth = Math.max(1, Math.min(200, Math.round(width)));
    const dimensions = this.options.dimensions();
    const createTemporary = (label: string) => device.createTexture({
      label,
      size: dimensions,
      format: SELECTION_TEXTURE_FORMAT,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT
        | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST
    });
    const outer = createTemporary('LightTable selection border outer');
    const inner = createTemporary('LightTable selection border inner');
    const encoder = device.createCommandEncoder({ label: 'LightTable selection border' });
    const buffers: GPUBuffer[] = [];
    this.encodeMorphology(
      encoder, textures.mask, outer, textures.shape, 'expand', Math.ceil(borderWidth / 2), true, buffers
    );
    this.encodeMorphology(
      encoder, textures.mask, inner, textures.shape, 'contract', Math.floor(borderWidth / 2), true, buffers
    );
    const pipeline = this.options.pipelines().selectionBorder;
    const bindGroup = device.createBindGroup({
      label: 'LightTable selection border bindings',
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: outer.createView() },
        { binding: 1, resource: inner.createView() }
      ]
    });
    this.options.drawFullscreen(
      encoder,
      pipeline,
      bindGroup,
      textures.result.createView(),
      { r: 0, g: 0, b: 0, a: 1 }
    );
    const featherTextures: GPUTexture[] = [];
    this.encodeFeather(
      encoder,
      textures.result,
      textures.shape,
      textures.result,
      0.75,
      true,
      buffers,
      featherTextures
    );
    device.queue.submit([encoder.finish()]);
    textures.swapMaskAndResult();
    releaseAfterSubmittedWork(() => device.queue.onSubmittedWorkDone(), () => {
      buffers.forEach((buffer) => buffer.destroy());
      featherTextures.forEach((texture) => texture.destroy());
      outer.destroy();
      inner.destroy();
    });
    return true;
  }

  private encodeMorphology(
    encoder: GPUCommandEncoder,
    sourceTexture: GPUTexture,
    targetTexture: GPUTexture,
    scratchTexture: GPUTexture,
    mode: 'expand' | 'contract',
    radius: number,
    applyAtCanvasBounds: boolean,
    buffers: GPUBuffer[]
  ) {
    const { device } = this.options;
    if (radius <= 0) {
      const { width, height } = this.options.dimensions();
      encoder.copyTextureToTexture(
        { texture: sourceTexture },
        { texture: targetTexture },
        { width, height }
      );
      return;
    }
    const steps: number[] = [];
    for (let reach = 0; reach < radius;) {
      const step = Math.min(reach + 1, radius - reach);
      steps.push(step);
      reach += step;
    }
    const pipeline = this.options.pipelines().selectionMorphology;
    const bindGroup = (
      source: GPUTexture,
      directionX: number,
      directionY: number,
      offset: number
    ) => {
      const settings = device.createBuffer({
        label: 'LightTable selection morphology settings',
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      });
      buffers.push(settings);
      device.queue.writeBuffer(settings, 0, new Int32Array([
        directionX,
        directionY,
        offset,
        mode === 'expand' ? 0 : 1,
        applyAtCanvasBounds ? 1 : 0,
        0,
        0,
        0
      ]));
      return device.createBindGroup({
        label: 'LightTable selection morphology bindings',
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: source.createView() },
          { binding: 1, resource: { buffer: settings } }
        ]
      });
    };
    let source = sourceTexture;
    let target = targetTexture;
    for (const [directionX, directionY] of [[1, 0], [0, 1]] as const) {
      for (const step of steps) {
        this.options.drawFullscreen(
          encoder,
          pipeline,
          bindGroup(source, directionX, directionY, step),
          target.createView(),
          { r: 0, g: 0, b: 0, a: 1 }
        );
        source = target;
        target = target === targetTexture ? scratchTexture : targetTexture;
      }
    }
    if (source !== targetTexture) {
      const { width, height } = this.options.dimensions();
      encoder.copyTextureToTexture(
        { texture: source },
        { texture: targetTexture },
        { width, height }
      );
    }
  }

  clear() {
    const { textures, device } = this.options;
    if (!textures.mask || !textures.result) return false;
    const encoder = device.createCommandEncoder({ label: 'Clear LightTable selection' });
    this.options.clearTexture(encoder, textures.mask, { r: 1, g: 0, b: 0, a: 1 });
    this.options.clearTexture(encoder, textures.result, { r: 1, g: 0, b: 0, a: 1 });
    device.queue.submit([encoder.finish()]);
    const changed = textures.active;
    textures.active = false;
    return changed;
  }
}
