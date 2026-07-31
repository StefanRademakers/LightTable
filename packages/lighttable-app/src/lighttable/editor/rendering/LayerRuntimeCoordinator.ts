import type {
  ImageDocument,
  LayerId,
  RasterLayer
} from '../document/documentTypes';
import {
  rasterRenderContract,
  type RasterRenderContract
} from './renderContract';
import type { LayerRuntimeStore } from './LayerRuntimeStore';

export interface LayerRuntimeCoordinatorOptions {
  store: LayerRuntimeStore;
  invalidateLayer: (layerId: LayerId) => void;
}

/**
 * Owns synchronization policy between the immutable layer tree and retained
 * GPU runtimes. Detached runtimes remain available for undo until an explicit
 * prune; pruning also invalidates dependent styled-layer caches.
 */
export class LayerRuntimeCoordinator {
  constructor(private readonly options: LayerRuntimeCoordinatorOptions) {}

  sync(document: ImageDocument) {
    this.options.store.sync(document.layers);
  }

  pruneDetached(keepLayerIds: ReadonlySet<LayerId>) {
    const removed = this.options.store.pruneDetached(keepLayerIds);
    removed.forEach((layerId) => this.options.invalidateLayer(layerId));
    return removed;
  }

  resolveRenderContract(layer: RasterLayer): RasterRenderContract | null {
    const runtime = this.options.store.raster(layer.id);
    return runtime ? rasterRenderContract(layer, runtime.texture) : null;
  }
}
