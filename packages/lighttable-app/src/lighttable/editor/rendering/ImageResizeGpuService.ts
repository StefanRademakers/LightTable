import type { ResizePlan, ConcreteResampleMethod } from '../../application/imageSize/imageSizeModel';
import type { ImageDocument, LayerId } from '../document/documentTypes';
import { walkLayerTree, walkRasterLayers } from '../document/layerTree';
import type { LayerRuntimeStore, RasterLayerRuntime } from './LayerRuntimeStore';
import type { SelectionTextureStore } from './SelectionTextureStore';

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
  const bundle = { color: create('rgba16float'), mask: create('r8unorm') };
  pipelines.set(device, bundle);
  return bundle;
};

interface RuntimeExchange {
  readonly layerId: LayerId;
  before: RasterLayerRuntime;
  after: RasterLayerRuntime;
  current: 'before' | 'after';
}

interface PendingRuntimeExchange {
  readonly layerId: LayerId;
  readonly before: RasterLayerRuntime;
  readonly after: RasterLayerRuntime;
}

interface TextureExchange {
  readonly layerId: LayerId;
  before: GPUTexture;
  after: GPUTexture;
  current: 'before' | 'after';
}

interface PendingTextureExchange {
  readonly layerId: LayerId;
  readonly before: GPUTexture;
  readonly after: GPUTexture;
}

interface SelectionExchange {
  before: { mask: GPUTexture; result: GPUTexture; shape: GPUTexture };
  after: { mask: GPUTexture; result: GPUTexture; shape: GPUTexture };
  current: 'before' | 'after';
}

export interface ReversibleGpuImageResize {
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
    if (!plan.resolvedMethod) return { apply: () => undefined, dispose: () => undefined };
    const bundle = pipelineBundle(this.options.device);
    const encoder = this.options.device.createCommandEncoder({ label: 'LightTable Image Size' });
    const pendingExchanges: PendingRuntimeExchange[] = [];
    const pendingMaskExchanges: PendingTextureExchange[] = [];
    const transients: GPUTexture[] = [];
    const buffers: GPUBuffer[] = [];
    for (const { layer } of walkRasterLayers(document.layers)) {
      const before = this.options.layers.raster(layer.id);
      if (!before) throw new Error(`Raster pixels are unavailable for ${layer.name}.`);
      const targetWidth = Math.max(1, Math.round(before.width * plan.scaleX));
      const targetHeight = Math.max(1, Math.round(before.height * plan.scaleY));
      const color = this.encodePasses(
        encoder, before.texture, before.width, before.height,
        targetWidth, targetHeight, plan.resolvedMethod, noiseReduction,
        bundle.color, 'rgba16float', transients, buffers
      );
      const maskTexture = before.maskTexture ? this.encodePasses(
        encoder, before.maskTexture, plan.sourceWidth, plan.sourceHeight,
        plan.targetWidth, plan.targetHeight, plan.resolvedMethod, noiseReduction,
        bundle.mask, 'r8unorm', transients, buffers
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
        bundle.mask, 'r8unorm', transients, buffers
      );
      pendingMaskExchanges.push({ layerId: node.id, before, after });
    }
    let selectionExchange: SelectionExchange | null = null;
    const selection = this.options.selection;
    if (selection.active && selection.mask && selection.result && selection.shape) {
      const before = { mask: selection.mask, result: selection.result, shape: selection.shape };
      const after = {
        mask: this.encodePasses(encoder, before.mask, plan.sourceWidth, plan.sourceHeight, plan.targetWidth, plan.targetHeight,
          plan.resolvedMethod, noiseReduction, bundle.mask, 'r8unorm', transients, buffers),
        result: this.encodePasses(encoder, before.result, plan.sourceWidth, plan.sourceHeight, plan.targetWidth, plan.targetHeight,
          plan.resolvedMethod, noiseReduction, bundle.mask, 'r8unorm', transients, buffers),
        shape: this.encodePasses(encoder, before.shape, plan.sourceWidth, plan.sourceHeight, plan.targetWidth, plan.targetHeight,
          plan.resolvedMethod, noiseReduction, bundle.mask, 'r8unorm', transients, buffers)
      };
      selectionExchange = { before, after, current: 'after' };
    }
    this.options.device.queue.submit([encoder.finish()]);
    void this.options.device.queue.onSubmittedWorkDone().then(() => {
      transients.forEach((texture) => texture.destroy());
      buffers.forEach((buffer) => buffer.destroy());
    });
    // Attach the completed resize as one atomic runtime mutation only after all
    // layer, mask and selection passes were encoded successfully. A failure
    // above therefore leaves the live document completely untouched.
    const exchanges: RuntimeExchange[] = pendingExchanges.map(({ layerId, before, after }) => {
      const displaced = this.options.layers.exchangeRaster(layerId, after);
      if (displaced !== before) throw new Error(`Raster runtime ${layerId} changed during Image Size.`);
      return { layerId, before, after, current: 'after' };
    });
    const maskExchanges: TextureExchange[] = pendingMaskExchanges.map(({ layerId, before, after }) => {
      const displaced = this.options.layers.exchangeMaskTexture(layerId, after);
      if (displaced !== before) throw new Error(`Mask runtime ${layerId} changed during Image Size.`);
      return { layerId, before, after, current: 'after' };
    });
    if (selectionExchange) {
      const displaced = selection.exchangeTargets(selectionExchange.after);
      if (displaced.mask !== selectionExchange.before.mask
        || displaced.result !== selectionExchange.before.result
        || displaced.shape !== selectionExchange.before.shape) {
        throw new Error('Selection targets changed during Image Size.');
      }
    }
    this.options.invalidateAll();
    return {
      apply: (state) => {
        for (const exchange of exchanges) {
          if (exchange.current === state) continue;
          const replacement = state === 'before' ? exchange.before : exchange.after;
          const displaced = this.options.layers.exchangeRaster(exchange.layerId, replacement);
          if (state === 'before') exchange.after = displaced;
          else exchange.before = displaced;
          exchange.current = state;
        }
        for (const exchange of maskExchanges) {
          if (exchange.current === state) continue;
          const replacement = state === 'before' ? exchange.before : exchange.after;
          const displaced = this.options.layers.exchangeMaskTexture(exchange.layerId, replacement);
          if (state === 'before') exchange.after = displaced;
          else exchange.before = displaced;
          exchange.current = state;
        }
        if (selectionExchange && selectionExchange.current !== state) {
          const replacement = state === 'before' ? selectionExchange.before : selectionExchange.after;
          const displaced = this.options.selection.exchangeTargets(replacement);
          if (state === 'before') selectionExchange.after = displaced;
          else selectionExchange.before = displaced;
          selectionExchange.current = state;
        }
        this.options.invalidateAll();
      },
      dispose: () => {
        const detachedTextures: GPUTexture[] = [];
        for (const exchange of exchanges) {
          const detached = exchange.current === 'after' ? exchange.before : exchange.after;
          detachedTextures.push(detached.texture);
          if (detached.maskTexture) detachedTextures.push(detached.maskTexture);
        }
        for (const exchange of maskExchanges) {
          detachedTextures.push(exchange.current === 'after' ? exchange.before : exchange.after);
        }
        if (selectionExchange) {
          const detached = selectionExchange.current === 'after' ? selectionExchange.before : selectionExchange.after;
          detachedTextures.push(detached.mask, detached.result, detached.shape);
        }
        // A history entry can be evicted while the detached snapshot still
        // participates in a submitted frame. Defer destruction until all
        // preceding GPU work is complete instead of relying on timing.
        void this.options.device.queue.onSubmittedWorkDone().then(() => {
          detachedTextures.forEach((texture) => texture.destroy());
        });
      }
    };
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
      const settings = this.options.device.createBuffer({
        label: 'LightTable image resize settings',
        size: RESIZE_SETTINGS_FLOATS * Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      });
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
      buffers.push(settings);
      current = destination; currentWidth = size.width; currentHeight = size.height;
    }
    return current;
  }
}
