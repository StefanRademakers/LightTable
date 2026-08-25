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
  retireTexture?: (texture: GPUTexture) => void;
  maxBlurTexturePairs?: number;
}

const DEFAULT_MAX_BLUR_TEXTURE_PAIRS = 3;

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

  private retire(texture: GPUTexture) {
    (this.options.retireTexture ?? ((target) => target.destroy()))(texture);
  }

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
    if (textures) {
      // Map insertion order doubles as a tiny LRU list. Radius gestures tend
      // to cross several downsample scales; keeping every historic scale
      // would make a single slider gesture permanently grow GPU memory.
      this.blurTextures.delete(key);
      this.blurTextures.set(key, textures);
    } else {
      textures = {
        horizontal: this.options.createTextureSized(
          'LightTable Layer Style blur horizontal', width, height
        ),
        vertical: this.options.createTextureSized(
          'LightTable Layer Style blur vertical', width, height
        )
      };
      this.blurTextures.set(key, textures);
      const maximum = Math.max(
        1,
        Math.floor(this.options.maxBlurTexturePairs ?? DEFAULT_MAX_BLUR_TEXTURE_PAIRS)
      );
      while (this.blurTextures.size > maximum) {
        const oldestKey = this.blurTextures.keys().next().value as string | undefined;
        if (!oldestKey) break;
        const oldest = this.blurTextures.get(oldestKey);
        this.blurTextures.delete(oldestKey);
        if (oldest) {
          this.retire(oldest.horizontal);
          this.retire(oldest.vertical);
        }
      }
    }
    return textures;
  }

  cached(layerId: LayerId, key: string | null) {
    if (!key) return null;
    const cached = this.cache.get(layerId);
    return cached?.key === key ? cached : null;
  }

  /** Last valid final presentation, for read-only tools such as layer picking. */
  latest(layerId: LayerId) {
    return this.cache.get(layerId) ?? null;
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
      if (destination) this.retire(destination.texture);
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
    this.retire(cached.texture);
    this.cache.delete(layerId);
  }

  releaseCache() {
    this.cache.forEach(({ texture }) => this.retire(texture));
    this.cache.clear();
  }

  releaseWorkTextures() {
    if (this.workTextures) {
      this.retire(this.workTextures.shape);
      this.retire(this.workTextures.first);
      this.retire(this.workTextures.second);
    }
    this.workTextures = null;
    this.blurTextures.forEach(({ horizontal, vertical }) => {
      this.retire(horizontal);
      this.retire(vertical);
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
