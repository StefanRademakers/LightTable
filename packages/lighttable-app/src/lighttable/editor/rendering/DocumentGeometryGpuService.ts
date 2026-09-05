import type { DocumentGeometryPlan } from '../../application/documentGeometry/documentGeometryModel';
import type { ImageDocument, LayerId } from '../document/documentTypes';
import { walkLayerTree } from '../document/layerTree';
import { invertMatrix } from '../geometry/affine';
import type { LayerRuntimeStore } from './LayerRuntimeStore';
import type { SelectionTextureStore } from './SelectionTextureStore';
import { releaseAfterSubmittedWork } from './SubmittedResourceRetainer';
import { LAYER_MASK_TEXTURE_FORMAT, SELECTION_TEXTURE_FORMAT } from './DocumentTextureFactory';
import {
  applyAtomicRuntimeState,
  createAtomicRuntimeExchange,
  type AtomicRuntimeExchange
} from './AtomicRuntimeExchange';

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

interface SelectionExchange {
  before: { mask: GPUTexture; result: GPUTexture; shape: GPUTexture };
  after: { mask: GPUTexture; result: GPUTexture; shape: GPUTexture };
}

interface TextureExchangeRecord {
  readonly layerId: LayerId;
  readonly before: GPUTexture;
  readonly after: GPUTexture;
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
  textures: readonly GPUTexture[],
  width: number,
  height: number
) => new Set(textures).size * Math.max(1, width) * Math.max(1, height) * 2;

export interface ReversibleGpuDocumentGeometry {
  readonly byteSize: number;
  apply(state: 'before' | 'after'): void;
  dispose(): void;
}
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
    const createdTextures: GPUTexture[] = [];
    const pending: Array<{ layerId: LayerId; before: GPUTexture; after: GPUTexture }> = [];
    let selectionExchange: SelectionExchange | null = null;
    let submitted = false;
    let runtimeAttached = false;
    let atomicExchanges: AtomicRuntimeExchange[] = [];
    try {
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
        createdTextures.push(target);
        const bindGroup = this.options.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
          { binding: 0, resource: source.createView() }, { binding: 1, resource: bundle.sampler },
          { binding: 2, resource: { buffer: settings } }
        ] });
        const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }] });
        pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup); pass.draw(3); pass.end();
        return target;
      };
      for (const { node } of walkLayerTree(document.layers)) {
        if (!node.mask) continue;
        const before = this.options.layers.maskTexture(node.id);
        if (!before) throw new Error(`Mask pixels are unavailable for ${node.name}.`);
        pending.push({
          layerId: node.id,
          before,
          after: encode(before, bundle.maskPipeline, LAYER_MASK_TEXTURE_FORMAT)
        });
      }
      const selection = this.options.selection;
      if (selection.active && selection.mask && selection.result && selection.shape) {
        const before = { mask: selection.mask, result: selection.result, shape: selection.shape };
        selectionExchange = { before, after: {
          mask: encode(before.mask, bundle.maskPipeline, SELECTION_TEXTURE_FORMAT),
          result: encode(before.result, bundle.maskPipeline, SELECTION_TEXTURE_FORMAT),
          shape: encode(before.shape, bundle.maskPipeline, SELECTION_TEXTURE_FORMAT)
        } };
      }
      this.options.device.queue.submit([encoder.finish()]);
      submitted = true;

      const exchanges: TextureExchangeRecord[] = pending.map((record) => ({
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
        ...(selectionRuntimeExchange ? [selectionRuntimeExchange] : [])
      ];
      const beforeTextures = exchanges.map(({ before }) => before);
      const afterTextures = exchanges.map(({ after }) => after);
      if (selectionExchange) {
        beforeTextures.push(...Object.values(selectionExchange.before));
        afterTextures.push(...Object.values(selectionExchange.after));
      }
      const byteSize = Math.max(
        estimatedUniqueTextureBytes(beforeTextures, plan.sourceWidth, plan.sourceHeight),
        estimatedUniqueTextureBytes(afterTextures, plan.targetWidth, plan.targetHeight)
      );
      applyAtomicRuntimeState(atomicExchanges, 'after');
      runtimeAttached = true;
      this.options.invalidateAll();
      releaseAfterSubmittedWork(
        () => this.options.device.queue.onSubmittedWorkDone(),
        () => settings.destroy()
      );
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
          const detached = exchanges.map((record) => record.exchange.current === 'after'
            ? record.before
            : record.after);
          if (selectionExchange && selectionRuntimeExchange) {
            const targets = selectionRuntimeExchange.current === 'after'
              ? selectionExchange.before
              : selectionExchange.after;
            detached.push(targets.mask, targets.result, targets.shape);
          }
          releaseAfterSubmittedWork(() => this.options.device.queue.onSubmittedWorkDone(), () => {
            destroyUniqueTextures(detached);
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
      const liveTextures = this.collectLiveTextures(pending);
      const detachedCreatedTextures = createdTextures.filter((texture) => !liveTextures.has(texture));
      const release = () => {
        destroyUniqueTextures(detachedCreatedTextures);
        settings.destroy();
      };
      if (submitted) releaseAfterSubmittedWork(
        () => this.options.device.queue.onSubmittedWorkDone(),
        release
      ); else release();
      if (failures.length > 1) {
        throw new AggregateError(failures, 'Document geometry failed and its GPU state could not be restored.');
      }
      throw reason;
    }
  }

  private collectLiveTextures(exchanges: readonly { layerId: LayerId }[]) {
    const live = new Set<GPUTexture>();
    exchanges.forEach(({ layerId }) => {
      const texture = this.options.layers.maskTexture(layerId);
      if (texture) live.add(texture);
    });
    const selection = this.options.selection;
    if (selection.mask) live.add(selection.mask);
    if (selection.result) live.add(selection.result);
    if (selection.shape) live.add(selection.shape);
    return live;
  }
}
