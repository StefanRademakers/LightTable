import type { LayerId } from '../document/documentTypes';
import type {
  DerivedPreviewRuntime,
  RasterLayerRuntime
} from './LayerRuntimeStore';

export type DocumentLayerResourceKey = string | symbol;

export interface NodeMaskRuntime {
  texture: GPUTexture;
  maskId: string;
}

export interface DocumentLayerResourceSet {
  readonly rasterRuntimes: Map<LayerId, RasterLayerRuntime>;
  readonly derivedPreviews: Map<LayerId, DerivedPreviewRuntime>;
  readonly nodeMasks: Map<LayerId, NodeMaskRuntime>;
}

const createSet = (): DocumentLayerResourceSet => ({
  rasterRuntimes: new Map(),
  derivedPreviews: new Map(),
  nodeMasks: new Map()
});

const destroySet = (set: DocumentLayerResourceSet) => {
  set.rasterRuntimes.forEach((runtime) => {
    runtime.texture.destroy();
    runtime.maskTexture?.destroy();
  });
  set.derivedPreviews.forEach((runtime) => runtime.texture.destroy());
  set.nodeMasks.forEach((runtime) => runtime.texture.destroy());
  set.rasterRuntimes.clear();
  set.derivedPreviews.clear();
  set.nodeMasks.clear();
};

/**
 * Canonical GPU pixel/mask ownership for all open documents.
 *
 * A renderer binds a lightweight LayerRuntimeStore facade to one set. Detaching
 * or destroying that renderer does not imply releasing the set; document close
 * is the only normal release boundary.
 */
export class DocumentLayerResourceRepository {
  private readonly sets = new Map<DocumentLayerResourceKey, DocumentLayerResourceSet>();

  has(key: DocumentLayerResourceKey): boolean {
    return this.sets.has(key);
  }

  get(key: DocumentLayerResourceKey): DocumentLayerResourceSet | undefined {
    return this.sets.get(key);
  }

  acquire(key: DocumentLayerResourceKey): DocumentLayerResourceSet {
    const existing = this.sets.get(key);
    if (existing) return existing;
    const created = createSet();
    this.sets.set(key, created);
    return created;
  }

  release(key: DocumentLayerResourceKey): boolean {
    const set = this.sets.get(key);
    if (!set) return false;
    destroySet(set);
    this.sets.delete(key);
    return true;
  }

  destroy(): void {
    for (const set of this.sets.values()) destroySet(set);
    this.sets.clear();
  }
}

const repositoriesByDevice = new WeakMap<GPUDevice, DocumentLayerResourceRepository>();

/** One canonical repository per shared GPU device, independent of canvases. */
export const documentLayerResourceRepositoryFor = (
  device: GPUDevice
): DocumentLayerResourceRepository => {
  const existing = repositoriesByDevice.get(device);
  if (existing) return existing;
  const created = new DocumentLayerResourceRepository();
  repositoriesByDevice.set(device, created);
  return created;
};
