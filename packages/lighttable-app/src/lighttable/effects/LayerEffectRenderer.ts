import type {
  AdjustmentLayer,
  RasterLayer
} from '../editor/document/documentTypes';
import { adjustmentStackHasOwner } from '../processing/adjustmentStack';
import type { LightTableEffectRuntimeCallbacks } from './types';
import { DocumentEffectRuntime } from './DocumentEffectRuntime';
import type { WarpDebugView } from './warp/warpTypes';
import type { MeshDeformationTelemetry } from './deformation/MeshDeformationEffect';

/**
 * Returns whether a layer needs a per-owner GPU effect runtime.
 *
 * Keep this lifecycle predicate aligned with the stages encoded below. Warp
 * nodes belong to `geometry`; Lens Fx and output nodes belong to `lens-fx`.
 * Grade-only stacks are handled by AdjustmentLayerRenderer and must not retain
 * a DocumentEffectRuntime.
 */
export const layerNeedsEffectRuntime = (
  layer: AdjustmentLayer | RasterLayer
): boolean => adjustmentStackHasOwner(layer.adjustmentStack, 'geometry')
  || adjustmentStackHasOwner(layer.adjustmentStack, 'lens-fx');

/**
 * Owns one geometry/Lens Fx runtime per layer owner.
 *
 * GPU settings buffers cannot be shared between several encoded layer passes:
 * queue writes performed before submit would otherwise make every pass observe
 * the final owner's settings. Per-owner runtimes keep ordering deterministic.
 */
export class LayerEffectRenderer {
  private readonly runtimes = new Map<string, DocumentEffectRuntime>();
  private width = 0;
  private height = 0;
  private warpDebugView: WarpDebugView = 'result';
  private warpDebugLayerId: string | null = null;

  constructor(
    private readonly device: GPUDevice,
    private readonly sampler: GPUSampler,
    private readonly vertexModule: GPUShaderModule,
    private readonly callbacks: LightTableEffectRuntimeCallbacks = {}
  ) {}

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.runtimes.forEach((runtime) => runtime.resize(width, height));
  }

  /**
   * Restricts the transient Warp diagnostic to one layer. Rendering every
   * warped owner as a displacement map would make a multi-layer composite
   * impossible to interpret and could obscure the selected layer entirely.
   */
  setWarpDebugVisualization(
    view: WarpDebugView,
    layerId: string | null
  ): boolean {
    if (
      this.warpDebugView === view
      && this.warpDebugLayerId === layerId
    ) return false;
    this.warpDebugView = view;
    this.warpDebugLayerId = layerId;
    this.runtimes.forEach((runtime, ownerId) => {
      runtime.setWarpDebugVisualization(
        view === 'displacement' && ownerId === layerId ? view : 'result'
      );
    });
    return true;
  }

  encodeSourceGeometry(
    encoder: GPUCommandEncoder,
    source: GPUTexture,
    layer: AdjustmentLayer | RasterLayer
  ): GPUTexture {
    return this.runtimeFor(layer)?.encodeSourceGeometry(encoder, source) ?? source;
  }

  encodeLinearSpatial(
    encoder: GPUCommandEncoder,
    source: GPUTexture,
    layer: AdjustmentLayer | RasterLayer
  ): GPUTexture {
    return this.runtimeFor(layer)?.encodeLinearSpatial(
      encoder,
      source,
      { visualizeDepth: false }
    ) ?? source;
  }

  encodeDisplayPost(
    encoder: GPUCommandEncoder,
    source: GPUTexture,
    layer: AdjustmentLayer | RasterLayer
  ): GPUTexture {
    return this.runtimeFor(layer)?.encodeDisplayPost(encoder, source, false) ?? source;
  }

  private runtimeFor(
    layer: AdjustmentLayer | RasterLayer
  ): DocumentEffectRuntime | null {
    if (!layer.adjustmentStack) return null;
    const scope = layer.type === 'adjustment' ? 'adjustment-layer' : 'layer';
    let runtime = this.runtimes.get(layer.id);
    if (!runtime) {
      runtime = DocumentEffectRuntime.createFromStack(
        {
          device: this.device,
          sampler: this.sampler,
          vertexModule: this.vertexModule,
          callbacks: this.callbacks
        },
        layer.adjustmentStack,
        scope
      );
      runtime.resize(this.width, this.height);
      this.runtimes.set(layer.id, runtime);
    } else {
      runtime.setAdjustmentStack(layer.adjustmentStack);
    }
    runtime.setWarpDebugVisualization(
      this.warpDebugView === 'displacement'
        && layer.id === this.warpDebugLayerId
        ? this.warpDebugView
        : 'result'
    );
    return runtime;
  }

  syncOwners(ownerIds: ReadonlySet<string>): void {
    for (const [id, runtime] of this.runtimes) {
      if (ownerIds.has(id)) continue;
      runtime.destroy();
      this.runtimes.delete(id);
    }
  }

  /** Includes every retained per-layer Lens Fx/geometry image resource. */
  estimatedTextureBytes(): number {
    let bytes = 0;
    this.runtimes.forEach((runtime) => { bytes += runtime.estimatedTextureBytes(); });
    return bytes;
  }

  deformationTelemetry(): MeshDeformationTelemetry | null {
    const snapshots = [...this.runtimes.values()].flatMap((runtime) => {
      const snapshot = runtime.deformationTelemetry();
      return snapshot ? [snapshot] : [];
    });
    if (snapshots.length === 0) return null;
    return snapshots.reduce<MeshDeformationTelemetry>((total, current) => ({
      targetUploadCount: total.targetUploadCount + current.targetUploadCount,
      targetUploadBytes: total.targetUploadBytes + current.targetUploadBytes,
      meshPassCount: total.meshPassCount + current.meshPassCount,
      meshPassEncodeMs: total.meshPassEncodeMs + current.meshPassEncodeMs,
      maximumMeshPassEncodeMs: Math.max(total.maximumMeshPassEncodeMs, current.maximumMeshPassEncodeMs)
    }), { targetUploadCount: 0, targetUploadBytes: 0, meshPassCount: 0,
      meshPassEncodeMs: 0, maximumMeshPassEncodeMs: 0 });
  }

  destroyImageResources(): void {
    this.runtimes.forEach((runtime) => runtime.destroyImageResources());
  }

  destroy(): void {
    this.runtimes.forEach((runtime) => runtime.destroy());
    this.runtimes.clear();
  }
}
