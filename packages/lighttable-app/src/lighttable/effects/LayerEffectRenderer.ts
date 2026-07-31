import type {
  AdjustmentLayer,
  RasterLayer
} from '../editor/document/documentTypes';
import type { LightTableEffectRuntimeCallbacks } from './types';
import { DocumentEffectRuntime } from './DocumentEffectRuntime';

/**
 * Owns one Lens Fx runtime per layer owner.
 *
 * GPU settings buffers cannot be shared between several encoded layer passes:
 * queue writes performed before submit would otherwise make every pass observe
 * the final owner's settings. Per-owner runtimes keep ordering deterministic.
 */
export class LayerEffectRenderer {
  private readonly runtimes = new Map<string, DocumentEffectRuntime>();
  private width = 0;
  private height = 0;

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

  encode(
    encoder: GPUCommandEncoder,
    source: GPUTexture,
    layer: AdjustmentLayer | RasterLayer
  ): GPUTexture {
    if (!layer.adjustmentStack) return source;
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
    const geometry = runtime.encodeSourceGeometry(encoder, source);
    const spatial = runtime.encodeLinearSpatial(
      encoder,
      geometry,
      { visualizeDepth: false }
    );
    return runtime.encodeDisplayPost(encoder, spatial, false);
  }

  syncOwners(ownerIds: ReadonlySet<string>): void {
    for (const [id, runtime] of this.runtimes) {
      if (ownerIds.has(id)) continue;
      runtime.destroy();
      this.runtimes.delete(id);
    }
  }

  destroyImageResources(): void {
    this.runtimes.forEach((runtime) => runtime.destroyImageResources());
  }

  destroy(): void {
    this.runtimes.forEach((runtime) => runtime.destroy());
    this.runtimes.clear();
  }
}
