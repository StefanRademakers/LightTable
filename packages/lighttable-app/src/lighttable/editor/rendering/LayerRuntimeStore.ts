import type { LayerId, LayerNode, RasterLayer } from '../document/documentTypes';
import { walkLayerTree, walkRasterLayers } from '../document/layerTree';

export interface RasterLayerRuntime {
  texture: GPUTexture;
  width: number;
  height: number;
  maskTexture: GPUTexture | null;
  maskId: string | null;
}

export type RasterPixelSurface = Pick<RasterLayerRuntime, 'texture' | 'width' | 'height'>;

interface NodeMaskRuntime {
  texture: GPUTexture;
  maskId: string;
}

export interface DerivedPreviewRuntime {
  texture: GPUTexture;
  width: number;
  height: number;
}

export interface LayerRuntimeStoreOptions {
  createRasterTexture: (label: string, width: number, height: number) => GPUTexture;
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
  private readonly derivedPreviews = new Map<LayerId, DerivedPreviewRuntime>();
  private readonly nodeMasks = new Map<LayerId, NodeMaskRuntime>();

  constructor(private readonly options: LayerRuntimeStoreOptions) {}

  sync(nodes: readonly LayerNode[]) {
    walkRasterLayers(nodes).forEach(({ layer }) => {
      const existing = this.rasterRuntimes.get(layer.id);
      if (!existing) {
        this.rasterRuntimes.set(layer.id, {
          texture: this.options.createRasterTexture(
            `LightTable layer: ${layer.name}`,
            layer.width,
            layer.height
          ),
          width: layer.width,
          height: layer.height,
          maskTexture: layer.mask
            ? this.options.createMaskTexture(`LightTable mask: ${layer.name}`)
            : null,
          maskId: layer.mask?.id ?? null
        });
      } else {
        if (existing.width !== layer.width || existing.height !== layer.height) {
          existing.texture.destroy();
          existing.texture = this.options.createRasterTexture(
            `LightTable layer: ${layer.name}`,
            layer.width,
            layer.height
          );
          existing.width = layer.width;
          existing.height = layer.height;
        }
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

    walkLayerTree(nodes).forEach(({ node }) => {
      const preview = node.derivedPreview;
      if (!preview) return;
      const existing = this.derivedPreviews.get(node.id);
      if (existing?.width === preview.width && existing.height === preview.height) return;
      existing?.texture.destroy();
      this.derivedPreviews.set(node.id, {
        texture: this.options.createRasterTexture(
          `LightTable derived preview: ${node.name}`,
          preview.width,
          preview.height
        ),
        width: preview.width,
        height: preview.height
      });
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

  exchangeRaster(layerId: LayerId, replacement: RasterLayerRuntime) {
    const current = this.rasterRuntimes.get(layerId);
    if (!current) throw new Error(`Raster runtime ${layerId} is unavailable.`);
    this.rasterRuntimes.set(layerId, replacement);
    return current;
  }

  /**
   * Exchanges only a raster's color surface while retaining its mask ownership.
   * Projective edits can promote a tight placed image to a document-sized
   * surface without duplicating or transferring the independent layer mask.
   */
  exchangeRasterPixels(layerId: LayerId, replacement: RasterPixelSurface): RasterPixelSurface {
    const current = this.rasterRuntimes.get(layerId);
    if (!current) throw new Error(`Raster runtime ${layerId} is unavailable.`);
    const displaced = {
      texture: current.texture,
      width: current.width,
      height: current.height
    };
    current.texture = replacement.texture;
    current.width = replacement.width;
    current.height = replacement.height;
    return displaced;
  }

  derivedPreview(layerId: LayerId) {
    return this.derivedPreviews.get(layerId) ?? null;
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
      texture: this.options.createRasterTexture(
        `LightTable layer: ${layer.name}`,
        layer.width,
        layer.height
      ),
      width: layer.width,
      height: layer.height,
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

  exchangeMaskTexture(layerId: LayerId, replacement: GPUTexture) {
    const raster = this.rasterRuntimes.get(layerId);
    if (raster?.maskTexture) {
      const current = raster.maskTexture;
      raster.maskTexture = replacement;
      return current;
    }
    const node = this.nodeMasks.get(layerId);
    if (!node) throw new Error(`Mask runtime ${layerId} is unavailable.`);
    const current = node.texture;
    node.texture = replacement;
    return current;
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
    this.derivedPreviews.forEach((runtime, id) => {
      if (keepMaskLayerIds.has(id)) return;
      runtime.texture.destroy();
      this.derivedPreviews.delete(id);
      if (!removedLayerIds.includes(id)) removedLayerIds.push(id);
    });
    return removedLayerIds;
  }

  estimatedTextureBytes(width: number, height: number) {
    const rgba16Bytes = Math.max(1, width) * Math.max(1, height) * 8;
    let bytes = 0;
    this.rasterRuntimes.forEach((runtime) => {
      bytes += Math.max(1, runtime.width) * Math.max(1, runtime.height) * 8;
      if (runtime.maskTexture) bytes += Math.max(1, width) * Math.max(1, height);
    });
    this.derivedPreviews.forEach((runtime) => {
      bytes += Math.max(1, runtime.width) * Math.max(1, runtime.height) * 8;
    });
    return bytes + this.nodeMasks.size * Math.max(1, width) * Math.max(1, height);
  }

  destroy() {
    this.rasterRuntimes.forEach((runtime) => {
      runtime.texture.destroy();
      runtime.maskTexture?.destroy();
    });
    this.rasterRuntimes.clear();
    this.derivedPreviews.forEach((runtime) => runtime.texture.destroy());
    this.derivedPreviews.clear();
    this.nodeMasks.forEach((runtime) => runtime.texture.destroy());
    this.nodeMasks.clear();
  }
}
