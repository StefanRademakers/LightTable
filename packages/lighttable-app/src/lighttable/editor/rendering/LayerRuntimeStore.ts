import type { LayerId, LayerNode, RasterLayer } from '../document/documentTypes';
import { walkLayerTree, walkRasterLayers } from '../document/layerTree';

export interface RasterLayerRuntime {
  texture: GPUTexture;
  maskTexture: GPUTexture | null;
  maskId: string | null;
}

interface NodeMaskRuntime {
  texture: GPUTexture;
  maskId: string;
}

export interface LayerRuntimeStoreOptions {
  createRasterTexture: (label: string) => GPUTexture;
  createMaskTexture: (label: string) => GPUTexture;
}

/**
 * Owns persistent pixel and mask textures for one document renderer.
 *
 * Detached raster runtimes intentionally survive document sync so bounded
 * undo/redo can restore deleted layers without synchronous GPU readback.
 * `pruneDetached` is the explicit history-boundary cleanup operation.
 */
export class LayerRuntimeStore {
  private readonly rasterRuntimes = new Map<LayerId, RasterLayerRuntime>();
  private readonly nodeMasks = new Map<LayerId, NodeMaskRuntime>();

  constructor(private readonly options: LayerRuntimeStoreOptions) {}

  sync(nodes: readonly LayerNode[]) {
    walkRasterLayers(nodes).forEach(({ layer }) => {
      const existing = this.rasterRuntimes.get(layer.id);
      if (!existing) {
        this.rasterRuntimes.set(layer.id, {
          texture: this.options.createRasterTexture(`LightTable layer: ${layer.name}`),
          maskTexture: layer.mask
            ? this.options.createMaskTexture(`LightTable mask: ${layer.name}`)
            : null,
          maskId: layer.mask?.id ?? null
        });
      } else {
        if (!layer.mask && existing.maskTexture) {
          existing.maskTexture.destroy();
          existing.maskTexture = null;
          existing.maskId = null;
        } else if (layer.mask && (!existing.maskTexture || existing.maskId !== layer.mask.id)) {
          existing.maskTexture?.destroy();
          const nodeMask = this.nodeMasks.get(layer.id);
          const adoptsNodeMask = nodeMask?.maskId === layer.mask.id;
          existing.maskTexture = adoptsNodeMask
            ? nodeMask.texture
            : this.options.createMaskTexture(`LightTable mask: ${layer.name}`);
          existing.maskId = layer.mask.id;
          if (adoptsNodeMask) this.nodeMasks.delete(layer.id);
        }
      }
    });

    const attachedNodeMasks = new Set<LayerId>();
    walkLayerTree(nodes).forEach(({ node }) => {
      if (node.type === 'raster') return;
      const retainedRaster = this.rasterRuntimes.get(node.id);
      if (!node.mask) {
        retainedRaster?.maskTexture?.destroy();
        if (retainedRaster) {
          retainedRaster.maskTexture = null;
          retainedRaster.maskId = null;
        }
        return;
      }
      attachedNodeMasks.add(node.id);
      if (
        retainedRaster?.maskTexture
        && retainedRaster.maskId === node.mask.id
      ) {
        const existingNodeMask = this.nodeMasks.get(node.id);
        existingNodeMask?.texture.destroy();
        this.nodeMasks.set(node.id, {
          texture: retainedRaster.maskTexture,
          maskId: node.mask.id
        });
        retainedRaster.maskTexture = null;
        retainedRaster.maskId = null;
        return;
      }
      const existing = this.nodeMasks.get(node.id);
      if (existing?.maskId === node.mask.id) return;
      existing?.texture.destroy();
      this.nodeMasks.set(node.id, {
        texture: this.options.createMaskTexture(`LightTable mask: ${node.name}`),
        maskId: node.mask.id
      });
    });
    this.nodeMasks.forEach((runtime, id) => {
      if (attachedNodeMasks.has(id)) return;
      runtime.texture.destroy();
      this.nodeMasks.delete(id);
    });
  }

  raster(layerId: LayerId) {
    return this.rasterRuntimes.get(layerId) ?? null;
  }

  hasRaster(layerId: LayerId) {
    return this.rasterRuntimes.has(layerId);
  }

  /** Releases a newly reserved raster while preserving a same-ID live node mask. */
  releaseRaster(layerId: LayerId, preserveMask = false) {
    const runtime = this.rasterRuntimes.get(layerId);
    if (!runtime) return false;
    runtime.texture.destroy();
    if (preserveMask && runtime.maskTexture && runtime.maskId) {
      this.nodeMasks.set(layerId, {
        texture: runtime.maskTexture,
        maskId: runtime.maskId
      });
    } else {
      runtime.maskTexture?.destroy();
    }
    this.rasterRuntimes.delete(layerId);
    return true;
  }

  /** Reserves a raster destination and transfers an existing node mask without readback. */
  ensureRaster(layer: RasterLayer): RasterLayerRuntime {
    const existing = this.rasterRuntimes.get(layer.id);
    if (existing) {
      const nodeMask = this.nodeMasks.get(layer.id);
      if (layer.mask && !existing.maskTexture && nodeMask?.maskId === layer.mask.id) {
        existing.maskTexture = nodeMask.texture;
        existing.maskId = nodeMask.maskId;
        this.nodeMasks.delete(layer.id);
      }
      return existing;
    }
    const nodeMask = this.nodeMasks.get(layer.id);
    const adoptsNodeMask = Boolean(
      layer.mask && nodeMask && nodeMask.maskId === layer.mask.id
    );
    const runtime: RasterLayerRuntime = {
      texture: this.options.createRasterTexture(`LightTable layer: ${layer.name}`),
      maskTexture: adoptsNodeMask
        ? nodeMask!.texture
        : layer.mask
          ? this.options.createMaskTexture(`LightTable mask: ${layer.name}`)
          : null,
      maskId: layer.mask?.id ?? null
    };
    if (adoptsNodeMask) this.nodeMasks.delete(layer.id);
    this.rasterRuntimes.set(layer.id, runtime);
    return runtime;
  }

  maskTexture(layerId: LayerId) {
    return this.rasterRuntimes.get(layerId)?.maskTexture
      ?? this.nodeMasks.get(layerId)?.texture
      ?? null;
  }

  pruneDetached(
    keepRasterLayerIds: ReadonlySet<LayerId>,
    keepMaskLayerIds: ReadonlySet<LayerId> = keepRasterLayerIds
  ) {
    const removedLayerIds: LayerId[] = [];
    this.rasterRuntimes.forEach((runtime, id) => {
      if (keepRasterLayerIds.has(id)) return;
      runtime.texture.destroy();
      runtime.maskTexture?.destroy();
      this.rasterRuntimes.delete(id);
      removedLayerIds.push(id);
    });
    this.nodeMasks.forEach((runtime, id) => {
      if (keepMaskLayerIds.has(id)) return;
      runtime.texture.destroy();
      this.nodeMasks.delete(id);
    });
    return removedLayerIds;
  }

  estimatedTextureBytes(width: number, height: number) {
    const rgba16Bytes = Math.max(1, width) * Math.max(1, height) * 8;
    let bytes = 0;
    this.rasterRuntimes.forEach((runtime) => {
      bytes += rgba16Bytes;
      if (runtime.maskTexture) bytes += rgba16Bytes;
    });
    return bytes + this.nodeMasks.size * rgba16Bytes;
  }

  destroy() {
    this.rasterRuntimes.forEach((runtime) => {
      runtime.texture.destroy();
      runtime.maskTexture?.destroy();
    });
    this.rasterRuntimes.clear();
    this.nodeMasks.forEach((runtime) => runtime.texture.destroy());
    this.nodeMasks.clear();
  }
}
