import type { DocumentGeometryPlan } from '../../application/documentGeometry/documentGeometryModel';
import type { ImageDocument, LayerId } from '../document/documentTypes';
import { walkLayerTree } from '../document/layerTree';
import { invertMatrix } from '../geometry/affine';
import type { LayerRuntimeStore } from './LayerRuntimeStore';
import type { SelectionTextureStore } from './SelectionTextureStore';
import { LAYER_MASK_TEXTURE_FORMAT, SELECTION_TEXTURE_FORMAT } from './DocumentTextureFactory';

const SETTINGS_FLOATS = 16;

export const DOCUMENT_GEOMETRY_MASK_WGSL = /* wgsl */`
struct Settings {
  sourceSize: vec2f,
  targetSize: vec2f,
  inverseRow0: vec4f,
  inverseRow1: vec4f,
  sampling: vec4f,
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
  if (settings.sampling.x > 0.5) {
    value = textureSampleLevel(sourceTexture, sourceSampler, sourceCenter / settings.sourceSize, 0.0).r;
  } else {
    value = textureLoad(sourceTexture, vec2i(floor(sourceCenter)), 0).r;
  }
  return vec4f(value, 0.0, 0.0, 1.0);
}
`;

interface GeometryPipelineBundle {
  readonly maskPipeline: GPURenderPipeline;
  readonly sampler: GPUSampler;
}
const bundles = new WeakMap<GPUDevice, GeometryPipelineBundle>();
const bundleFor = (device: GPUDevice): GeometryPipelineBundle => {
  const cached = bundles.get(device); if (cached) return cached;
  const vertex = device.createShaderModule({ code: `
    @vertex fn main(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
      let x = f32(i32(index & 1u) * 4 - 1); let y = f32(i32(index >> 1u) * 4 - 1);
      return vec4f(x, y, 0.0, 1.0);
    }` });
  const fragment = device.createShaderModule({ code: DOCUMENT_GEOMETRY_MASK_WGSL });
  const create = (label: string, format: GPUTextureFormat) => device.createRenderPipeline({
    label, layout: 'auto',
    vertex: { module: vertex, entryPoint: 'main' },
    fragment: { module: fragment, entryPoint: 'main', targets: [{ format }] },
    primitive: { topology: 'triangle-list' }
  });
  const bundle = {
    maskPipeline: create('LightTable document geometry mask transfer', LAYER_MASK_TEXTURE_FORMAT),
    sampler: device.createSampler({ minFilter: 'linear', magFilter: 'linear' })
  };
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
    const encode = (source: GPUTexture, pipeline: GPURenderPipeline, format: GPUTextureFormat) => {
      const target = this.options.device.createTexture({ label: 'LightTable transformed mask',
        size: [plan.targetWidth, plan.targetHeight], format,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT
          | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST });
      const bindGroup = this.options.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: source.createView() }, { binding: 1, resource: bundle.sampler },
        { binding: 2, resource: { buffer: settings } }
      ] });
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }] });
      pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup); pass.draw(3); pass.end();
      return target;
    };
    const pending = [...walkLayerTree(document.layers)]
      .filter(({ node }) => Boolean(node.mask))
      .map(({ node }) => {
        const before = this.options.layers.maskTexture(node.id);
        if (!before) throw new Error(`Mask pixels are unavailable for ${node.name}.`);
        return { layerId: node.id, before,
          after: encode(before, bundle.maskPipeline, LAYER_MASK_TEXTURE_FORMAT) };
      });
    let selectionExchange: SelectionExchange | null = null;
    const selection = this.options.selection;
    if (selection.active && selection.mask && selection.result && selection.shape) {
      const before = { mask: selection.mask, result: selection.result, shape: selection.shape };
      selectionExchange = { before, after: {
        mask: encode(before.mask, bundle.maskPipeline, SELECTION_TEXTURE_FORMAT),
        result: encode(before.result, bundle.maskPipeline, SELECTION_TEXTURE_FORMAT),
        shape: encode(before.shape, bundle.maskPipeline, SELECTION_TEXTURE_FORMAT)
      }, current: 'after' };
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
