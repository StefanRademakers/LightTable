import type { CompositeSelectionChannel, SelectionMode, SelectionShape } from '../selection/selectionTypes';
import type { SelectionTextureStore } from './SelectionTextureStore';
import type { ToolPipelineBundle } from './ToolPipelineBundle';

const selectionModeValue: Record<SelectionMode, number> = {
  replace: 0,
  add: 1,
  subtract: 2,
  intersect: 3,
  invert: 4,
  feather: 5
};

export interface SelectionShapeBuffers {
  points: Float32Array<ArrayBuffer>;
  settings: Float32Array<ArrayBuffer>;
}

export const selectionShapeBuffers = (
  shape: SelectionShape,
  width: number,
  height: number
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
      last.y
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
  constructor(private readonly options: SelectionRasterizerOptions) {}

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
      this.options.pipelines().selectionToMask,
      'LightTable bake selection into layer mask'
    );
    return true;
  }

  loadMask(source: GPUTexture) {
    this.options.ensureTargets();
    const { textures } = this.options;
    if (!textures.mask) return false;
    this.copyRedChannel(
      source,
      textures.mask,
      this.options.pipelines().maskToSelection,
      'LightTable load layer mask as selection'
    );
    textures.active = true;
    return true;
  }

  loadColorChannel(source: GPUTexture, channel: CompositeSelectionChannel) {
    this.options.ensureTargets();
    const { textures, device } = this.options;
    if (!textures.mask) return false;
    const pipeline = this.options.pipelines().channelToSelection;
    const settings = device.createBuffer({
      label: 'LightTable composite channel selection settings',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(settings, 0, new Uint32Array([
      channel === 'red' ? 0 : channel === 'green' ? 1 : channel === 'blue' ? 2 : 3,
      0,
      0,
      0
    ]));
    const bindGroup = device.createBindGroup({
      label: 'LightTable composite channel selection bindings',
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: source.createView() },
        { binding: 1, resource: { buffer: settings } }
      ]
    });
    const encoder = device.createCommandEncoder({
      label: 'LightTable load composite channel as selection'
    });
    this.options.drawFullscreen(
      encoder,
      pipeline,
      bindGroup,
      textures.mask.createView(),
      { r: 0, g: 0, b: 0, a: 1 }
    );
    device.queue.submit([encoder.finish()]);
    textures.active = true;
    void device.queue.onSubmittedWorkDone().then(() => settings.destroy());
    return true;
  }

  set(shape: SelectionShape, requestedMode: SelectionMode) {
    this.options.ensureTargets();
    const { textures, device } = this.options;
    if (!textures.mask || !textures.result || !textures.shape) return false;
    const { width, height } = this.options.dimensions();
    const shapeData = selectionShapeBuffers(shape, width, height);
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
    const shapeEncoder = device.createCommandEncoder({
      label: 'LightTable rasterize selection shape'
    });
    this.options.drawFullscreen(
      shapeEncoder,
      pipelines.selectionShape,
      shapeBindGroup,
      textures.shape.createView(),
      { r: 0, g: 0, b: 0, a: 1 }
    );
    device.queue.submit([shapeEncoder.finish()]);
    const combineEncoder = device.createCommandEncoder({
      label: 'LightTable combine selection mask'
    });
    this.options.drawFullscreen(
      combineEncoder,
      pipelines.selectionCombine,
      combineBindGroup,
      textures.result.createView(),
      { r: 0, g: 0, b: 0, a: 1 }
    );
    device.queue.submit([combineEncoder.finish()]);
    textures.swapMaskAndResult();
    textures.active = true;
    void device.queue.onSubmittedWorkDone().then(() => {
      pointBuffer.destroy();
      shapeBuffer.destroy();
      combineBuffer.destroy();
    });
    return true;
  }

  feather(radius: number) {
    const { textures, device, sampler } = this.options;
    if (!textures.active || !textures.mask || !textures.result) return false;
    const clampedRadius = Math.max(0, Math.min(250, radius));
    if (clampedRadius <= 0) return true;
    const { width, height } = this.options.dimensions();
    const pipeline = this.options.pipelines().selectionFeather;
    const plan = selectionFeatherPlan(clampedRadius, width, height);
    const { scale, workingWidth: featherWidth, workingHeight: featherHeight } = plan;
    const temporaryTextures = scale === 1 ? [] : [
      device.createTexture({
        label: 'LightTable feather selection low-resolution source',
        size: { width: featherWidth, height: featherHeight },
        format: 'r8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT
      }),
      device.createTexture({
        label: 'LightTable feather selection low-resolution horizontal',
        size: { width: featherWidth, height: featherHeight },
        format: 'r8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT
      }),
      device.createTexture({
        label: 'LightTable feather selection low-resolution vertical',
        size: { width: featherWidth, height: featherHeight },
        format: 'r8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT
      })
    ];
    const encoder = device.createCommandEncoder({
      label: 'LightTable high-quality selection feather'
    });
    const submittedBuffers: GPUBuffer[] = [];
    const encodePass = (
      label: string,
      direction: [number, number],
      source: GPUTexture,
      target: GPUTexture,
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
        sourceWidth, sourceHeight, direction[0], direction[1], passRadius, 0, 0, 0
      ]));
      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: source.createView() },
          { binding: 1, resource: sampler },
          { binding: 2, resource: { buffer: settingsBuffer } }
        ]
      });
      this.options.drawFullscreen(
        encoder,
        pipeline,
        bindGroup,
        target.createView(),
        { r: 0, g: 0, b: 0, a: 1 }
      );
      submittedBuffers.push(settingsBuffer);
    };
    let horizontalSource = textures.mask;
    let horizontalTarget = textures.result;
    let verticalTarget = textures.mask;
    if (scale > 1) {
      const resamplePipeline = this.options.pipelines().selectionResample;
      const downsampleBindGroup = device.createBindGroup({
        label: 'LightTable feather selection downsample bindings',
        layout: resamplePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: textures.mask.createView() },
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
        textures.mask.createView(),
        { r: 0, g: 0, b: 0, a: 1 }
      );
    }
    device.queue.submit([encoder.finish()]);
    void device.queue.onSubmittedWorkDone().then(() => {
      submittedBuffers.forEach((buffer) => buffer.destroy());
      temporaryTextures.forEach((texture) => texture.destroy());
    });
    return true;
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
