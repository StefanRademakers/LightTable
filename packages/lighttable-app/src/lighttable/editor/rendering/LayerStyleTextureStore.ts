import type { LayerId } from '../document/documentTypes';

export interface LayerStyleWorkTextures {
  shape: GPUTexture;
  first: GPUTexture;
  second: GPUTexture;
}

interface CachedStyleTexture {
  key: string;
  texture: GPUTexture;
}

export interface LayerStyleTextureStoreOptions {
  createTexture: (label: string) => GPUTexture;
}

/**
 * Owns reusable Layer Style work targets and persistent per-layer results.
 * Rendering code decides what to encode; this store owns allocation,
 * invalidation and destruction.
 */
export class LayerStyleTextureStore {
  private workTextures: LayerStyleWorkTextures | null = null;
  private readonly cache = new Map<LayerId, CachedStyleTexture>();

  constructor(private readonly options: LayerStyleTextureStoreOptions) {}

  ensureWorkTextures() {
    this.workTextures ??= {
      shape: this.options.createTexture('LightTable Layer Style shape'),
      first: this.options.createTexture('LightTable Layer Style work A'),
      second: this.options.createTexture('LightTable Layer Style work B')
    };
    return this.workTextures;
  }

  cached(layerId: LayerId, key: string | null) {
    if (!key) return null;
    const cached = this.cache.get(layerId);
    return cached?.key === key ? cached.texture : null;
  }

  writeCache(
    encoder: GPUCommandEncoder,
    layerId: LayerId,
    key: string,
    layerName: string,
    source: GPUTexture,
    size: GPUExtent3DStrict
  ) {
    let destination = this.cache.get(layerId);
    if (!destination) {
      destination = {
        key,
        texture: this.options.createTexture(`LightTable cached Layer Style: ${layerName}`)
      };
      this.cache.set(layerId, destination);
    } else {
      destination.key = key;
    }
    encoder.copyTextureToTexture({ texture: source }, { texture: destination.texture }, size);
  }

  invalidate(layerId: LayerId) {
    const cached = this.cache.get(layerId);
    if (!cached) return;
    cached.texture.destroy();
    this.cache.delete(layerId);
  }

  releaseCache() {
    this.cache.forEach(({ texture }) => texture.destroy());
    this.cache.clear();
  }

  releaseWorkTextures() {
    if (!this.workTextures) return;
    this.workTextures.shape.destroy();
    this.workTextures.first.destroy();
    this.workTextures.second.destroy();
    this.workTextures = null;
  }

  estimatedTextureBytes(width: number, height: number) {
    const bytesPerTexture = Math.max(1, width) * Math.max(1, height) * 8;
    return (this.cache.size + (this.workTextures ? 3 : 0)) * bytesPerTexture;
  }

  destroy() {
    this.releaseCache();
    this.releaseWorkTextures();
  }
}
