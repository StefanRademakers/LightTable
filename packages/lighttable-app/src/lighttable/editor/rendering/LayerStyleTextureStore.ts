import type { LayerId, Rect } from '../document/documentTypes';

export interface LayerStyleWorkTextures {
  shape: GPUTexture;
  first: GPUTexture;
  second: GPUTexture;
}

export interface LayerStyleBlurTextures {
  horizontal: GPUTexture;
  vertical: GPUTexture;
}

export interface CachedStyleTexture {
  key: string;
  texture: GPUTexture;
  bounds: Rect;
}

export interface LayerStyleTextureStoreOptions {
  createTexture: (label: string) => GPUTexture;
  createTextureSized: (label: string, width: number, height: number) => GPUTexture;
}

/**
 * Owns reusable Layer Style work targets and persistent per-layer results.
 * Rendering code decides what to encode; this store owns allocation,
 * invalidation and destruction.
 */
export class LayerStyleTextureStore {
  private workTextures: LayerStyleWorkTextures | null = null;
  private readonly blurTextures = new Map<string, LayerStyleBlurTextures>();
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

  ensureBlurTextures(width: number, height: number) {
    const key = `${width}x${height}`;
    let textures = this.blurTextures.get(key);
    if (!textures) {
      textures = {
        horizontal: this.options.createTextureSized(
          'LightTable Layer Style blur horizontal', width, height
        ),
        vertical: this.options.createTextureSized(
          'LightTable Layer Style blur vertical', width, height
        )
      };
      this.blurTextures.set(key, textures);
    }
    return textures;
  }

  cached(layerId: LayerId, key: string | null) {
    if (!key) return null;
    const cached = this.cache.get(layerId);
    return cached?.key === key ? cached : null;
  }

  writeCache(
    encoder: GPUCommandEncoder,
    layerId: LayerId,
    key: string,
    layerName: string,
    source: GPUTexture,
    bounds: Rect
  ) {
    let destination = this.cache.get(layerId);
    if (
      !destination
      || destination.bounds.width !== bounds.width
      || destination.bounds.height !== bounds.height
    ) {
      destination?.texture.destroy();
      destination = {
        key,
        texture: this.options.createTextureSized(
          `LightTable cached Layer Style: ${layerName}`,
          bounds.width,
          bounds.height
        ),
        bounds
      };
      this.cache.set(layerId, destination);
    } else {
      destination.key = key;
      destination.bounds = bounds;
    }
    encoder.copyTextureToTexture(
      { texture: source, origin: { x: bounds.x, y: bounds.y } },
      { texture: destination.texture },
      [bounds.width, bounds.height]
    );
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
    this.workTextures?.shape.destroy();
    this.workTextures?.first.destroy();
    this.workTextures?.second.destroy();
    this.workTextures = null;
    this.blurTextures.forEach(({ horizontal, vertical }) => {
      horizontal.destroy();
      vertical.destroy();
    });
    this.blurTextures.clear();
  }

  estimatedTextureBytes(width: number, height: number) {
    const bytesPerWorkTexture = Math.max(1, width) * Math.max(1, height) * 8;
    const cacheBytes = [...this.cache.values()].reduce(
      (bytes, { bounds }) => bytes + bounds.width * bounds.height * 8,
      0
    );
    const blurBytes = [...this.blurTextures.keys()].reduce((bytes, key) => {
      const [width = 0, height = 0] = key.split('x').map(Number);
      return bytes + width * height * 8 * 2;
    }, 0);
    return cacheBytes + blurBytes + (this.workTextures ? 3 * bytesPerWorkTexture : 0);
  }

  destroy() {
    this.releaseCache();
    this.releaseWorkTextures();
  }
}
