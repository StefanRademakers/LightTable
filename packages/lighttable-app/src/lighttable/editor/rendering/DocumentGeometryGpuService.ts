import type { DocumentGeometryPlan } from '../../application/documentGeometry/documentGeometryModel';
import type { ImageDocument, LayerId } from '../document/documentTypes';
import { walkLayerTree } from '../document/layerTree';
import { invertMatrix } from '../geometry/affine';
import type { LayerRuntimeStore } from './LayerRuntimeStore';
import type { SelectionTextureStore } from './SelectionTextureStore';

const SETTINGS_FLOATS = 16;

export const DOCUMENT_GEOMETRY_MASK_WGSL = /* wgsl */`
struct Settings {
  sourceSize: vec2f,
  targetSize: vec2f,
  inverseRow0: vec4f,
  inverseRow1: vec4f,
  filtered: f32,
  _padding: vec3f,
};
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;
@group(0) @binding(2) var<uniform> settings: Settings;

@fragment fn main(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let destinationCenter = floor(position.xy) + vec2f(0.5);
  let sourceCenter = vec2f(
    dot(settings.inverseRow0.xyz, vec3f(destinationCenter, 1.0)),
    dot(settings.inverseRow1.xyz, vec3f(destinationCenter, 1.0))
  );
  let inside = all(sourceCenter >= vec2f(0.0)) && all(sourceCenter < settings.sourceSize);
  if (!inside) { return vec4f(0.0); }
  var value = 0.0;
  if (settings.filtered > 0.5) {
    value = textureSampleLevel(sourceTexture, sourceSampler, sourceCenter / settings.sourceSize, 0.0).r;
  } else {
    value = textureLoad(sourceTexture, vec2i(floor(sourceCenter)), 0).r;
  }
  return vec4f(value, 0.0, 0.0, 1.0);
}
`;

interface GeometryPipelineBundle { readonly pipeline: GPURenderPipeline; readonly sampler: GPUSampler }
const bundles = new WeakMap<GPUDevice, GeometryPipelineBundle>();
const bundleFor = (device: GPUDevice): GeometryPipelineBundle => {
  const cached = bundles.get(device); if (cached) return cached;
  const pipeline = device.createRenderPipeline({
    label: 'LightTable document geometry mask transfer', layout: 'auto',
    vertex: { module: device.createShaderModule({ code: `
      @vertex fn main(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
        let x = f32(i32(index & 1u) * 4 - 1); let y = f32(i32(index >> 1u) * 4 - 1);
        return vec4f(x, y, 0.0, 1.0);
      }` }), entryPoint: 'main' },
    fragment: { module: device.createShaderModule({ code: DOCUMENT_GEOMETRY_MASK_WGSL }),
      entryPoint: 'main', targets: [{ format: 'r8unorm' }] },
    primitive: { topology: 'triangle-list' }
  });
  const bundle = { pipeline, sampler: device.createSampler({ minFilter: 'linear', magFilter: 'linear' }) };
  bundles.set(device, bundle); return bundle;
};

interface TextureExchange { readonly layerId: LayerId; before: GPUTexture; after: GPUTexture; current: 'before' | 'after' }
interface SelectionExchange {
  before: { mask: GPUTexture; result: GPUTexture; shape: GPUTexture };
  after: { mask: GPUTexture; result: GPUTexture; shape: GPUTexture };
  current: 'before' | 'after';
}

export interface ReversibleGpuDocumentGeometry { apply(state: 'before' | 'after'): void; dispose(): void }
export interface DocumentGeometryGpuServiceOptions {
  readonly device: GPUDevice;
  readonly layers: LayerRuntimeStore;
  readonly selection: SelectionTextureStore;
  readonly invalidateAll: () => void;
}

export class DocumentGeometryGpuService {
  constructor(private readonly options: DocumentGeometryGpuServiceOptions) {}

  transfer(document: ImageDocument, plan: DocumentGeometryPlan): ReversibleGpuDocumentGeometry {
    const inverse = invertMatrix(plan.oldDocumentToNewDocument);
    if (!inverse) throw new Error('Document geometry mapping is not invertible.');
    const bundle = bundleFor(this.options.device);
    const encoder = this.options.device.createCommandEncoder({ label: 'LightTable document geometry' });
    const settings = this.options.device.createBuffer({ label: 'LightTable document geometry settings',
      size: SETTINGS_FLOATS * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.options.device.queue.writeBuffer(settings, 0, new Float32Array([
      plan.sourceWidth, plan.sourceHeight, plan.targetWidth, plan.targetHeight,
      inverse.a, inverse.c, inverse.tx, 0, inverse.b, inverse.d, inverse.ty, 0,
      plan.sampling === 'filtered-affine' ? 1 : 0, 0, 0, 0
    ]));
    const encode = (source: GPUTexture) => {
      const target = this.options.device.createTexture({ label: 'LightTable transformed mask',
        size: [plan.targetWidth, plan.targetHeight], format: 'r8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT
          | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST });
      const bindGroup = this.options.device.createBindGroup({ layout: bundle.pipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: source.createView() }, { binding: 1, resource: bundle.sampler },
        { binding: 2, resource: { buffer: settings } }
      ] });
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }] });
      pass.setPipeline(bundle.pipeline); pass.setBindGroup(0, bindGroup); pass.draw(3); pass.end();
      return target;
    };
    const pending = [...walkLayerTree(document.layers)]
      .filter(({ node }) => Boolean(node.mask))
      .map(({ node }) => {
        const before = this.options.layers.maskTexture(node.id);
        if (!before) throw new Error(`Mask pixels are unavailable for ${node.name}.`);
        return { layerId: node.id, before, after: encode(before) };
      });
    let selectionExchange: SelectionExchange | null = null;
    const selection = this.options.selection;
    if (selection.active && selection.mask && selection.result && selection.shape) {
      const before = { mask: selection.mask, result: selection.result, shape: selection.shape };
      selectionExchange = { before, after: { mask: encode(before.mask), result: encode(before.result), shape: encode(before.shape) }, current: 'after' };
    }
    this.options.device.queue.submit([encoder.finish()]);
    const exchanges: TextureExchange[] = pending.map(({ layerId, before, after }) => {
      const displaced = this.options.layers.exchangeMaskTexture(layerId, after);
      if (displaced !== before) throw new Error(`Mask runtime ${layerId} changed during document geometry.`);
      return { layerId, before, after, current: 'after' };
    });
    if (selectionExchange) {
      const displaced = selection.exchangeTargets(selectionExchange.after);
      if (displaced.mask !== selectionExchange.before.mask || displaced.result !== selectionExchange.before.result
        || displaced.shape !== selectionExchange.before.shape) throw new Error('Selection targets changed during document geometry.');
    }
    this.options.invalidateAll();
    return {
      apply: (state) => {
        for (const exchange of exchanges) {
          if (exchange.current === state) continue;
          const displaced = this.options.layers.exchangeMaskTexture(exchange.layerId,
            state === 'before' ? exchange.before : exchange.after);
          if (state === 'before') exchange.after = displaced; else exchange.before = displaced;
          exchange.current = state;
        }
        if (selectionExchange && selectionExchange.current !== state) {
          const displaced = selection.exchangeTargets(state === 'before' ? selectionExchange.before : selectionExchange.after);
          if (state === 'before') selectionExchange.after = displaced; else selectionExchange.before = displaced;
          selectionExchange.current = state;
        }
        this.options.invalidateAll();
      },
      dispose: () => {
        const detached = exchanges.map((exchange) => exchange.current === 'after' ? exchange.before : exchange.after);
        if (selectionExchange) {
          const targets = selectionExchange.current === 'after' ? selectionExchange.before : selectionExchange.after;
          detached.push(targets.mask, targets.result, targets.shape);
        }
        void this.options.device.queue.onSubmittedWorkDone().then(() => {
          detached.forEach((texture) => texture.destroy()); settings.destroy();
        });
      }
    };
  }
}
