import type { SelectionMode, SelectionShape } from '../selection/selectionTypes';
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
    const encodePass = (
      label: string,
      direction: [number, number],
      source: GPUTexture,
      target: GPUTexture
    ) => {
      const settingsBuffer = device.createBuffer({
        label: `${label} settings`,
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      });
      device.queue.writeBuffer(settingsBuffer, 0, new Float32Array([
        width, height, direction[0], direction[1], clampedRadius, 0, 0, 0
      ]));
      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: source.createView() },
          { binding: 1, resource: sampler },
          { binding: 2, resource: { buffer: settingsBuffer } }
        ]
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
      return settingsBuffer;
    };
    const horizontalBuffer = encodePass(
      'LightTable feather selection horizontal',
      [1, 0],
      textures.mask,
      textures.result
    );
    const verticalBuffer = encodePass(
      'LightTable feather selection vertical',
      [0, 1],
      textures.result,
      textures.mask
    );
    void device.queue.onSubmittedWorkDone().then(() => {
      horizontalBuffer.destroy();
      verticalBuffer.destroy();
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
