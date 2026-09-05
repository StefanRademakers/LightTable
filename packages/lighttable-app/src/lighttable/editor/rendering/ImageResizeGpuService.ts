import type { ResizePlan, ConcreteResampleMethod } from '../document/imageResizeTypes';
import type { ImageDocument, LayerId } from '../document/documentTypes';
import { walkLayerTree, walkRasterLayers } from '../document/layerTree';
import type { LayerRuntimeStore, RasterLayerRuntime } from './LayerRuntimeStore';
import type { SelectionTextureStore } from './SelectionTextureStore';
import { releaseAfterSubmittedWork } from './SubmittedResourceRetainer';
import { LAYER_MASK_TEXTURE_FORMAT, SELECTION_TEXTURE_FORMAT } from './DocumentTextureFactory';
import {
  applyAtomicRuntimeState,
  createAtomicRuntimeExchange,
  type AtomicRuntimeExchange
} from './AtomicRuntimeExchange';

const RESIZE_SETTINGS_FLOATS = 8;

export const IMAGE_RESIZE_WGSL = /* wgsl */`
struct Settings {
  sourceSize: vec2f,
  targetSize: vec2f,
  method: f32,
  noiseReduction: f32,
  _padding: vec2f,
};
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var<uniform> settings: Settings;

fn loadClamped(point: vec2i) -> vec4f {
  let maximum = vec2i(settings.sourceSize) - vec2i(1);
  return textureLoad(sourceTexture, clamp(point, vec2i(0), maximum), 0);
}

fn cubicWeight(xValue: f32, b: f32, c: f32) -> f32 {
  let x = abs(xValue);
  if (x < 1.0) {
    return ((12.0 - 9.0 * b - 6.0 * c) * x * x * x
      + (-18.0 + 12.0 * b + 6.0 * c) * x * x
      + (6.0 - 2.0 * b)) / 6.0;
  }
  if (x < 2.0) {
    return ((-b - 6.0 * c) * x * x * x
      + (6.0 * b + 30.0 * c) * x * x
      + (-12.0 * b - 48.0 * c) * x
      + (8.0 * b + 24.0 * c)) / 6.0;
  }
  return 0.0;
}

fn bilinear(source: vec2f) -> vec4f {
  let base = vec2i(floor(source));
  let fraction = fract(source);
  let top = mix(loadClamped(base), loadClamped(base + vec2i(1, 0)), fraction.x);
  let bottom = mix(loadClamped(base + vec2i(0, 1)), loadClamped(base + vec2i(1, 1)), fraction.x);
  return mix(top, bottom, fraction.y);
}

fn bicubic(source: vec2f, b: f32, c: f32) -> vec4f {
  let base = vec2i(floor(source));
  var sum = vec4f(0.0);
  var total = 0.0;
  for (var y = -1; y <= 2; y = y + 1) {
    let wy = cubicWeight(source.y - f32(base.y + y), b, c);
    for (var x = -1; x <= 2; x = x + 1) {
      let weight = wy * cubicWeight(source.x - f32(base.x + x), b, c);
      sum += loadClamped(base + vec2i(x, y)) * weight;
      total += weight;
    }
  }
  return sum / max(total, 0.000001);
}

@fragment fn main(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let destination = floor(position.xy);
  let source = ((destination + vec2f(0.5)) * settings.sourceSize / settings.targetSize) - vec2f(0.5);
  if (settings.method < 0.5) {
    return loadClamped(vec2i(round(source)));
  }
  if (settings.method < 1.5) {
    return bilinear(source);
  }
  var b = 0.0;
  var c = 0.5;
  if (settings.method > 2.5 && settings.method < 3.5) { b = 1.0; c = 0.0; }
  if (settings.method > 3.5 && settings.method < 4.5) { b = 0.0; c = 0.75; }
  let reconstructed = bicubic(source, b, c);
  if (settings.method < 5.5) { return reconstructed; }
  let center = bilinear(source);
  let left = bilinear(source + vec2f(-1.0, 0.0));
  let right = bilinear(source + vec2f(1.0, 0.0));
  let top = bilinear(source + vec2f(0.0, -1.0));
  let bottom = bilinear(source + vec2f(0.0, 1.0));
  let localAverage = (left + right + top + bottom) * 0.25;
  let edge = center - localAverage;
  let suppression = clamp(settings.noiseReduction, 0.0, 1.0);
  let detailStrength = select(0.35, 0.55, settings.method > 6.5) * (1.0 - suppression * 0.7);
  return reconstructed + edge * detailStrength;
}
`;

const methodCode = (method: ConcreteResampleMethod): number => ({
  nearest: 0, bilinear: 1, bicubic: 2,
  'bicubic-smoother': 3, 'bicubic-sharper': 4,
  'preserve-details': 6, 'preserve-details-2': 7
})[method];

interface ResizePipelineBundle {
  readonly color: GPURenderPipeline;
  readonly mask: GPURenderPipeline;
}

const pipelines = new WeakMap<GPUDevice, ResizePipelineBundle>();

const pipelineBundle = (device: GPUDevice): ResizePipelineBundle => {
  const cached = pipelines.get(device);
  if (cached) return cached;
  const shader = device.createShaderModule({ code: IMAGE_RESIZE_WGSL });
  const vertex = device.createShaderModule({ code: `
    @vertex fn main(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
      let x = f32(i32(index & 1u) * 4 - 1);
      let y = f32(i32(index >> 1u) * 4 - 1);
      return vec4f(x, y, 0.0, 1.0);
    }
  ` });
  const create = (format: GPUTextureFormat) => device.createRenderPipeline({
    label: `LightTable image resize ${format}`,
    layout: 'auto',
    vertex: { module: vertex, entryPoint: 'main' },
    fragment: { module: shader, entryPoint: 'main', targets: [{ format }] },
    primitive: { topology: 'triangle-list' }
  });
  const bundle = {
    color: create('rgba16float'),
    mask: create(LAYER_MASK_TEXTURE_FORMAT)
  };
  pipelines.set(device, bundle);
  return bundle;
};

interface PendingRuntimeExchange {
  readonly layerId: LayerId;
  readonly before: RasterLayerRuntime;
  readonly after: RasterLayerRuntime;
}

interface PendingTextureExchange {
  readonly layerId: LayerId;
  readonly before: GPUTexture;
  readonly after: GPUTexture;
}

interface SelectionExchange {
  before: { mask: GPUTexture; result: GPUTexture; shape: GPUTexture };
  after: { mask: GPUTexture; result: GPUTexture; shape: GPUTexture };
}

interface RuntimeExchangeRecord extends PendingRuntimeExchange {
  readonly exchange: AtomicRuntimeExchange;
}

interface TextureExchangeRecord extends PendingTextureExchange {
  readonly exchange: AtomicRuntimeExchange;
}

type SelectionTargets = SelectionExchange['before'];

const sameSelectionTargets = (left: SelectionTargets, right: SelectionTargets) => (
  left.mask === right.mask
  && left.result === right.result
  && left.shape === right.shape
);

const destroyUniqueTextures = (textures: readonly GPUTexture[]) => {
  new Set(textures).forEach((texture) => texture.destroy());
};

const estimatedUniqueTextureBytes = (
  allocations: readonly {
    readonly texture: GPUTexture;
    readonly width: number;
    readonly height: number;
    readonly bytesPerPixel: number;
  }[]
) => {
  const bytesByTexture = new Map<GPUTexture, number>();
  allocations.forEach(({ texture, width, height, bytesPerPixel }) => {
    const bytes = Math.max(1, width) * Math.max(1, height) * bytesPerPixel;
    bytesByTexture.set(texture, Math.max(bytesByTexture.get(texture) ?? 0, bytes));
  });
  return [...bytesByTexture.values()].reduce((total, bytes) => total + bytes, 0);
};

export interface ReversibleGpuImageResize {
  readonly byteSize: number;
  apply(state: 'before' | 'after'): void;
  dispose(): void;
}

export interface ImageResizeGpuServiceOptions {
  readonly device: GPUDevice;
  readonly layers: LayerRuntimeStore;
  readonly selection: SelectionTextureStore;
  readonly invalidateAll: () => void;
}

export class ImageResizeGpuService {
  constructor(private readonly options: ImageResizeGpuServiceOptions) {}

  resize(document: ImageDocument, plan: ResizePlan, noiseReduction: number): ReversibleGpuImageResize {
    if (!plan.resolvedMethod) return { byteSize: 0, apply: () => undefined, dispose: () => undefined };
    const bundle = pipelineBundle(this.options.device);
    const encoder = this.options.device.createCommandEncoder({ label: 'LightTable Image Size' });
    const pendingExchanges: PendingRuntimeExchange[] = [];
    const pendingMaskExchanges: PendingTextureExchange[] = [];
    const createdTextures: GPUTexture[] = [];
    const transients: GPUTexture[] = [];
    const buffers: GPUBuffer[] = [];
    let selectionExchange: SelectionExchange | null = null;
    let submitted = false;
    let runtimeAttached = false;
    let atomicExchanges: AtomicRuntimeExchange[] = [];
    try {
      for (const { layer } of walkRasterLayers(document.layers)) {
        const before = this.options.layers.raster(layer.id);
        if (!before) throw new Error(`Raster pixels are unavailable for ${layer.name}.`);
        const targetWidth = Math.max(1, Math.round(before.width * plan.scaleX));
        const targetHeight = Math.max(1, Math.round(before.height * plan.scaleY));
        const color = this.encodePasses(
          encoder, before.texture, before.width, before.height,
          targetWidth, targetHeight, plan.resolvedMethod, noiseReduction,
          bundle.color, 'rgba16float', createdTextures, transients, buffers
        );
        const maskTexture = before.maskTexture ? this.encodePasses(
          encoder, before.maskTexture, plan.sourceWidth, plan.sourceHeight,
          plan.targetWidth, plan.targetHeight, plan.resolvedMethod, noiseReduction,
          bundle.mask, LAYER_MASK_TEXTURE_FORMAT, createdTextures, transients, buffers
        ) : null;
        const after: RasterLayerRuntime = {
          texture: color,
          width: targetWidth,
          height: targetHeight,
          maskTexture,
          maskId: before.maskId
        };
        pendingExchanges.push({ layerId: layer.id, before, after });
      }
      for (const { node } of walkLayerTree(document.layers)) {
        if (node.type === 'raster' || !node.mask) continue;
        const before = this.options.layers.maskTexture(node.id);
        if (!before) throw new Error(`Mask pixels are unavailable for ${node.name}.`);
        const after = this.encodePasses(
          encoder, before, plan.sourceWidth, plan.sourceHeight,
          plan.targetWidth, plan.targetHeight, plan.resolvedMethod, noiseReduction,
          bundle.mask, LAYER_MASK_TEXTURE_FORMAT, createdTextures, transients, buffers
        );
        pendingMaskExchanges.push({ layerId: node.id, before, after });
      }
      const selection = this.options.selection;
      if (selection.active && selection.mask && selection.result && selection.shape) {
        const before = { mask: selection.mask, result: selection.result, shape: selection.shape };
        const after = {
          mask: this.encodePasses(encoder, before.mask, plan.sourceWidth, plan.sourceHeight, plan.targetWidth, plan.targetHeight,
            plan.resolvedMethod, noiseReduction, bundle.mask, SELECTION_TEXTURE_FORMAT, createdTextures, transients, buffers),
          result: this.encodePasses(encoder, before.result, plan.sourceWidth, plan.sourceHeight, plan.targetWidth, plan.targetHeight,
            plan.resolvedMethod, noiseReduction, bundle.mask, SELECTION_TEXTURE_FORMAT, createdTextures, transients, buffers),
          shape: this.encodePasses(encoder, before.shape, plan.sourceWidth, plan.sourceHeight, plan.targetWidth, plan.targetHeight,
            plan.resolvedMethod, noiseReduction, bundle.mask, SELECTION_TEXTURE_FORMAT, createdTextures, transients, buffers)
        };
        selectionExchange = { before, after };
      }
      this.options.device.queue.submit([encoder.finish()]);
      submitted = true;

      // Prepared resources become live as one atomic state transition. The
      // helper compensates earlier exchanges if a later runtime changed.
      const exchanges: RuntimeExchangeRecord[] = pendingExchanges.map((record) => ({
        ...record,
        exchange: createAtomicRuntimeExchange({
          label: `Raster runtime ${record.layerId}`,
          before: record.before,
          after: record.after,
          exchange: (replacement) => this.options.layers.exchangeRaster(record.layerId, replacement)
        })
      }));
      const maskExchanges: TextureExchangeRecord[] = pendingMaskExchanges.map((record) => ({
        ...record,
        exchange: createAtomicRuntimeExchange({
          label: `Mask runtime ${record.layerId}`,
          before: record.before,
          after: record.after,
          exchange: (replacement) => this.options.layers.exchangeMaskTexture(record.layerId, replacement)
        })
      }));
      const selectionRuntimeExchange = selectionExchange
        ? createAtomicRuntimeExchange({
            label: 'Selection targets',
            before: selectionExchange.before,
            after: selectionExchange.after,
            exchange: (replacement) => selection.exchangeTargets(replacement),
            equals: sameSelectionTargets
          })
        : null;
      atomicExchanges = [
        ...exchanges.map((record) => record.exchange),
        ...maskExchanges.map((record) => record.exchange),
        ...(selectionRuntimeExchange ? [selectionRuntimeExchange] : [])
      ];
      const beforeAllocations = [
        ...exchanges.flatMap(({ before }) => [
          { texture: before.texture, width: before.width, height: before.height, bytesPerPixel: 8 },
          ...(before.maskTexture ? [{
            texture: before.maskTexture,
            width: plan.sourceWidth,
            height: plan.sourceHeight,
            bytesPerPixel: 2
          }] : [])
        ]),
        ...maskExchanges.map(({ before }) => ({
          texture: before,
          width: plan.sourceWidth,
          height: plan.sourceHeight,
          bytesPerPixel: 2
        })),
        ...(selectionExchange ? Object.values(selectionExchange.before).map((texture) => ({
          texture,
          width: plan.sourceWidth,
          height: plan.sourceHeight,
          bytesPerPixel: 2
        })) : [])
      ];
      const afterAllocations = [
        ...exchanges.flatMap(({ after }) => [
          { texture: after.texture, width: after.width, height: after.height, bytesPerPixel: 8 },
          ...(after.maskTexture ? [{
            texture: after.maskTexture,
            width: plan.targetWidth,
            height: plan.targetHeight,
            bytesPerPixel: 2
          }] : [])
        ]),
        ...maskExchanges.map(({ after }) => ({
          texture: after,
          width: plan.targetWidth,
          height: plan.targetHeight,
          bytesPerPixel: 2
        })),
        ...(selectionExchange ? Object.values(selectionExchange.after).map((texture) => ({
          texture,
          width: plan.targetWidth,
          height: plan.targetHeight,
          bytesPerPixel: 2
        })) : [])
      ];
      const byteSize = Math.max(
        estimatedUniqueTextureBytes(beforeAllocations),
        estimatedUniqueTextureBytes(afterAllocations)
      );
      applyAtomicRuntimeState(atomicExchanges, 'after');
      runtimeAttached = true;
      this.options.invalidateAll();
      releaseAfterSubmittedWork(() => this.options.device.queue.onSubmittedWorkDone(), () => {
        destroyUniqueTextures(transients);
        buffers.forEach((buffer) => buffer.destroy());
      });
      return {
        byteSize,
        apply: (state) => {
          try {
            applyAtomicRuntimeState(atomicExchanges, state);
          } finally {
            this.options.invalidateAll();
          }
        },
        dispose: () => {
          const detachedTextures: GPUTexture[] = [];
          for (const record of exchanges) {
            const detached = record.exchange.current === 'after' ? record.before : record.after;
            detachedTextures.push(detached.texture);
            if (detached.maskTexture) detachedTextures.push(detached.maskTexture);
          }
          for (const record of maskExchanges) {
            detachedTextures.push(record.exchange.current === 'after' ? record.before : record.after);
          }
          if (selectionExchange && selectionRuntimeExchange) {
            const detached = selectionRuntimeExchange.current === 'after'
              ? selectionExchange.before
              : selectionExchange.after;
            detachedTextures.push(detached.mask, detached.result, detached.shape);
          }
          // A history entry can be evicted while the detached snapshot still
          // participates in a submitted frame. Defer destruction until all
          // preceding GPU work is complete instead of relying on timing.
          releaseAfterSubmittedWork(() => this.options.device.queue.onSubmittedWorkDone(), () => {
            destroyUniqueTextures(detachedTextures);
          });
        }
      };
    } catch (reason) {
      const failures = [reason];
      if (runtimeAttached) {
        try {
          applyAtomicRuntimeState(atomicExchanges, 'before');
          runtimeAttached = false;
        } catch (rollbackReason) {
          failures.push(rollbackReason);
        }
      }
      const liveTextures = this.collectLiveTextures(pendingExchanges, pendingMaskExchanges);
      const detachedCreatedTextures = createdTextures.filter((texture) => !liveTextures.has(texture));
      const release = () => {
        destroyUniqueTextures(detachedCreatedTextures);
        buffers.forEach((buffer) => buffer.destroy());
      };
      if (submitted) releaseAfterSubmittedWork(
        () => this.options.device.queue.onSubmittedWorkDone(),
        release
      ); else release();
      if (failures.length > 1) {
        throw new AggregateError(failures, 'Image Size failed and its GPU state could not be restored.');
      }
      throw reason;
    }
  }

  private collectLiveTextures(
    rasterExchanges: readonly PendingRuntimeExchange[],
    maskExchanges: readonly PendingTextureExchange[]
  ) {
    const live = new Set<GPUTexture>();
    rasterExchanges.forEach(({ layerId }) => {
      const runtime = this.options.layers.raster(layerId);
      if (!runtime) return;
      live.add(runtime.texture);
      if (runtime.maskTexture) live.add(runtime.maskTexture);
    });
    maskExchanges.forEach(({ layerId }) => {
      const texture = this.options.layers.maskTexture(layerId);
      if (texture) live.add(texture);
    });
    const selection = this.options.selection;
    if (selection.mask) live.add(selection.mask);
    if (selection.result) live.add(selection.result);
    if (selection.shape) live.add(selection.shape);
    return live;
  }

  private encodePasses(
    encoder: GPUCommandEncoder,
    source: GPUTexture,
    sourceWidth: number,
    sourceHeight: number,
    targetWidth: number,
    targetHeight: number,
    method: ConcreteResampleMethod,
    noiseReduction: number,
    pipeline: GPURenderPipeline,
    format: GPUTextureFormat,
    createdTextures: GPUTexture[],
    transients: GPUTexture[],
    buffers: GPUBuffer[]
  ) {
    const passSizes: Array<{ width: number; height: number }> = [];
    let width = sourceWidth; let height = sourceHeight;
    while (targetWidth / width < 0.5 || targetHeight / height < 0.5) {
      width = Math.max(targetWidth, Math.ceil(width / 2));
      height = Math.max(targetHeight, Math.ceil(height / 2));
      passSizes.push({ width, height });
    }
    if (width !== targetWidth || height !== targetHeight) passSizes.push({ width: targetWidth, height: targetHeight });
    let current = source; let currentWidth = sourceWidth; let currentHeight = sourceHeight;
    for (let index = 0; index < passSizes.length; index += 1) {
      const size = passSizes[index]!;
      const destination = this.options.device.createTexture({
        label: 'LightTable resized layer pixels', size: [size.width, size.height], format,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT
          | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST
      });
      createdTextures.push(destination);
      const settings = this.options.device.createBuffer({
        label: 'LightTable image resize settings',
        size: RESIZE_SETTINGS_FLOATS * Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      });
      buffers.push(settings);
      this.options.device.queue.writeBuffer(settings, 0, new Float32Array([
        currentWidth, currentHeight, size.width, size.height,
        methodCode(method), noiseReduction / 100, 0, 0
      ]));
      const bindGroup = this.options.device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: current.createView() },
          { binding: 1, resource: { buffer: settings } }
        ]
      });
      const pass = encoder.beginRenderPass({ colorAttachments: [{
        view: destination.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear', storeOp: 'store'
      }] });
      pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup); pass.draw(3); pass.end();
      if (current !== source) transients.push(current);
      current = destination; currentWidth = size.width; currentHeight = size.height;
    }
    return current;
  }
}
