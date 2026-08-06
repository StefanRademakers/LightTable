import type {
  DocumentAssetId,
  ImageDocument,
  LayerId,
  LayerNode
} from '../document/documentTypes';
import {
  walkLayerTree,
  walkRasterLayers
} from '../document/layerTree';
import {
  multiplyMatrices,
  transformedBounds,
  translationMatrix
} from '../geometry/affine';
import type {
  DocumentAssetBlob,
  PatternAssetBlob
} from '../persistence/layeredDocumentFormat';

export interface LayerDocumentAssetPorts {
  rasterTexture: (layerId: LayerId) => GPUTexture | null;
  derivedPreviewTexture: (layerId: LayerId) => GPUTexture | null;
  maskTexture: (layerId: LayerId) => GPUTexture | null;
  encodeTexture: (
    layerId: LayerId,
    texture: GPUTexture,
    maskChannel: boolean,
    output?: {
      width: number;
      height: number;
      sourceToOutput: ReturnType<typeof translationMatrix>;
    }
  ) => Promise<Blob>;
  encodeSemanticLayer: (
    document: ImageDocument,
    layer: Exclude<LayerNode, { type: 'group' | 'adjustment' }>
  ) => Promise<Blob>;
  decodeTexture: (
    layerId: LayerId,
    blob: Blob,
    texture: GPUTexture,
    maskChannel: boolean
  ) => Promise<void>;
  invalidateLayer: (layerId: LayerId) => void;
  patternSource: (patternId: DocumentAssetId) => Blob | null;
  loadPattern: (asset: PatternAssetBlob) => Promise<void>;
}

interface EncodedAssetCacheEntry {
  readonly key: string;
  readonly blob: Blob;
  readonly usedAt: number;
}

const MAX_ENCODED_ASSET_CACHE_BYTES = 128 * 1024 * 1024;

const yieldToInteraction = async (): Promise<void> => {
  const browserScheduler = (globalThis as typeof globalThis & {
    scheduler?: { yield?: () => Promise<void> };
  }).scheduler;
  if (browserScheduler?.yield) await browserScheduler.yield();
  else await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

/**
 * Owns layered-document asset transfer policy without owning GPU resources.
 *
 * The renderer supplies narrow texture and codec ports. This service decides
 * which canonical document nodes participate in save/reopen, keeping binary
 * persistence orchestration separate from interactive compositing.
 */
export class LayerDocumentAssetService {
  private readonly rasterCache = new Map<LayerId, EncodedAssetCacheEntry>();
  private readonly maskCache = new Map<LayerId, EncodedAssetCacheEntry>();
  private readonly previewCache = new Map<LayerId, EncodedAssetCacheEntry>();
  private cacheBytes = 0;
  private cacheSequence = 0;

  constructor(private readonly ports: LayerDocumentAssetPorts) {}

  async export(document: ImageDocument): Promise<DocumentAssetBlob[]> {
    this.pruneDocumentCache(document);
    const assets: DocumentAssetBlob[] = [];
    for (const { layer } of walkRasterLayers(document.layers)) {
      const texture = this.ports.rasterTexture(layer.id);
      if (!texture) throw new Error(`Layer ${layer.name} is not available for saving.`);
      const maskTexture = layer.mask ? this.ports.maskTexture(layer.id) : null;
      if (!maskTexture) this.drop(this.maskCache, layer.id);
      assets.push({
        layerId: layer.id,
        pixels: await this.cached(this.rasterCache, layer.id,
          `${layer.pixelRevision}:${layer.width}:${layer.height}`,
          () => this.ports.encodeTexture(layer.id, texture, false)),
        mask: maskTexture
          ? await this.cached(this.maskCache, layer.id,
            `${layer.mask!.id}:${layer.mask!.pixelRevision}`,
            () => this.ports.encodeTexture(layer.id, maskTexture, true))
          : null
      });
      await yieldToInteraction();
    }

    for (const { node } of walkLayerTree(document.layers)) {
      if (node.type === 'raster' || !node.mask) continue;
      const maskTexture = this.ports.maskTexture(node.id);
      if (!maskTexture) throw new Error(`Mask ${node.name} is not available for saving.`);
      assets.push({
        layerId: node.id,
        pixels: node.derivedPreview
          ? await this.encodeDerivedPreview(node.id, node.name,
            `${node.derivedPreview.dependencyKey}:${node.derivedPreview.width}:${node.derivedPreview.height}`)
          : new Blob(),
        mask: await this.cached(this.maskCache, node.id,
          `${node.mask.id}:${node.mask.pixelRevision}`,
          () => this.ports.encodeTexture(node.id, maskTexture, true))
      });
      await yieldToInteraction();
    }

    for (const { node } of walkLayerTree(document.layers)) {
      if (node.type === 'raster' || node.mask || !node.derivedPreview) continue;
      assets.push({
        layerId: node.id,
        pixels: await this.encodeDerivedPreview(node.id, node.name,
          `${node.derivedPreview.dependencyKey}:${node.derivedPreview.width}:${node.derivedPreview.height}`),
        mask: null
      });
      await yieldToInteraction();
    }

    for (const pattern of document.assets.patterns) {
      const source = this.ports.patternSource(pattern.id);
      if (!source) throw new Error(`Pattern ${pattern.name} is not available for saving.`);
      assets.push({ patternId: pattern.id, source });
    }
    return assets;
  }

  /** Exports tight, document-space PSD previews and bakes arbitrary raster affines. */
  async exportPsd(document: ImageDocument): Promise<DocumentAssetBlob[]> {
    const assets: DocumentAssetBlob[] = [];
    for (const { layer } of walkRasterLayers(document.layers)) {
      const texture = this.ports.rasterTexture(layer.id);
      if (!texture) throw new Error(`Layer ${layer.name} is not available for PSD export.`);
      const transformed = transformedBounds(layer.transform, {
        x: 0, y: 0, width: layer.width, height: layer.height
      });
      const left = Math.floor(transformed.x);
      const top = Math.floor(transformed.y);
      const right = Math.ceil(transformed.x + transformed.width);
      const bottom = Math.ceil(transformed.y + transformed.height);
      const width = Math.max(1, right - left);
      const height = Math.max(1, bottom - top);
      const sourceToOutput = multiplyMatrices(
        translationMatrix(-left, -top),
        layer.transform
      );
      const maskTexture = layer.mask ? this.ports.maskTexture(layer.id) : null;
      assets.push({
        layerId: layer.id,
        bounds: { x: left, y: top, width, height },
        pixels: await this.ports.encodeTexture(layer.id, texture, false, {
          width, height, sourceToOutput
        }),
        mask: maskTexture
          ? await this.ports.encodeTexture(layer.id, maskTexture, true)
          : null
      });
    }
    const semanticNodes = walkLayerTree(document.layers)
      .map(({ node }) => node)
      .filter((node) => node.type !== 'raster')
      .sort((left, right) => Number(right.type === 'text') - Number(left.type === 'text'));
    for (const node of semanticNodes) {
      const maskTexture = node.mask ? this.ports.maskTexture(node.id) : null;
      const previewTexture = node.derivedPreview
        ? this.ports.derivedPreviewTexture(node.id) : null;
      let pixels = new Blob();
      let bounds: { x: number; y: number; width: number; height: number } | undefined;
      if (node.derivedPreview && previewTexture) {
        const preview = node.derivedPreview;
        const transformed = transformedBounds(preview.transform, {
          x: 0, y: 0, width: preview.width, height: preview.height
        });
        const left = Math.floor(transformed.x);
        const top = Math.floor(transformed.y);
        const right = Math.ceil(transformed.x + transformed.width);
        const bottom = Math.ceil(transformed.y + transformed.height);
        bounds = { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
        pixels = await this.ports.encodeTexture(node.id, previewTexture, false, {
          width: bounds.width,
          height: bounds.height,
          sourceToOutput: multiplyMatrices(
            translationMatrix(-left, -top), preview.transform
          )
        });
      } else if (node.type === 'text' || node.type === 'vector') {
        // Photoshop keeps the layer bitmap as the immediate visual fallback
        // for newly-authored TySh/vector descriptors. ag-psd deliberately
        // does not generate that cache, so materialize our exact GPU source
        // without effects; Photoshop applies the exported styles itself.
        pixels = await this.ports.encodeSemanticLayer(document, node);
        bounds = { x: 0, y: 0, width: document.width, height: document.height };
      }
      if (pixels.size || maskTexture) assets.push({
        layerId: node.id,
        ...(bounds ? { bounds } : {}),
        pixels,
        mask: maskTexture
          ? await this.ports.encodeTexture(node.id, maskTexture, true)
          : null
      });
    }
    return assets;
  }

  async load(assets: readonly DocumentAssetBlob[]) {
    for (const asset of assets) {
      if ('sourceId' in asset) continue;
      if ('fingerprintSha256' in asset) continue;
      if ('patternId' in asset) {
        await this.ports.loadPattern(asset);
        continue;
      }

      this.ports.invalidateLayer(asset.layerId);
      this.invalidateCache(asset.layerId);
      if (asset.pixels.size > 0) {
        const texture = this.ports.rasterTexture(asset.layerId)
          ?? this.ports.derivedPreviewTexture(asset.layerId);
        if (!texture) {
          throw new Error(`Layer ${asset.layerId} is not available while opening the document.`);
        }
        await this.ports.decodeTexture(asset.layerId, asset.pixels, texture, false);
      }
      if (asset.mask) {
        const maskTexture = this.ports.maskTexture(asset.layerId);
        if (!maskTexture) {
          throw new Error(`Mask ${asset.layerId} is not available while opening the document.`);
        }
        await this.ports.decodeTexture(asset.layerId, asset.mask, maskTexture, true);
      }
    }
  }

  private async encodeDerivedPreview(layerId: LayerId, name: string, key: string) {
    const texture = this.ports.derivedPreviewTexture(layerId);
    if (!texture) throw new Error(`Derived preview ${name} is not available for saving.`);
    return this.cached(this.previewCache, layerId, key,
      () => this.ports.encodeTexture(layerId, texture, false));
  }

  private async cached(
    cache: Map<LayerId, EncodedAssetCacheEntry>,
    layerId: LayerId,
    key: string,
    encode: () => Promise<Blob>
  ): Promise<Blob> {
    const existing = cache.get(layerId);
    if (existing?.key === key) {
      cache.set(layerId, { ...existing, usedAt: ++this.cacheSequence });
      return existing.blob;
    }
    const blob = await encode();
    this.remember(cache, layerId, key, blob);
    return blob;
  }

  private remember(cache: Map<LayerId, EncodedAssetCacheEntry>, layerId: LayerId, key: string, blob: Blob): void {
    const existing = cache.get(layerId);
    if (existing) this.cacheBytes -= existing.blob.size;
    cache.set(layerId, { key, blob, usedAt: ++this.cacheSequence });
    this.cacheBytes += blob.size; this.trimCache();
  }

  private invalidateCache(layerId: LayerId): void {
    for (const cache of [this.rasterCache, this.maskCache, this.previewCache]) {
      this.drop(cache, layerId);
    }
  }

  private pruneDocumentCache(document: ImageDocument): void {
    const nodes = walkLayerTree(document.layers).map(({ node }) => node);
    const live = new Set(nodes.map(({ id }) => id));
    for (const cache of [this.rasterCache, this.maskCache, this.previewCache]) {
      for (const layerId of cache.keys()) if (!live.has(layerId)) this.drop(cache, layerId);
    }
    for (const node of nodes) {
      if (!node.mask) this.drop(this.maskCache, node.id);
      if (!node.derivedPreview) this.drop(this.previewCache, node.id);
    }
  }

  private drop(cache: Map<LayerId, EncodedAssetCacheEntry>, layerId: LayerId): void {
    const entry = cache.get(layerId);
    if (entry) this.cacheBytes -= entry.blob.size;
    cache.delete(layerId);
  }

  private trimCache(): void {
    if (this.cacheBytes <= MAX_ENCODED_ASSET_CACHE_BYTES) return;
    const entries = [this.rasterCache, this.maskCache, this.previewCache]
      .flatMap((cache) => [...cache].map(([layerId, entry]) => ({ cache, layerId, entry })))
      .sort((left, right) => left.entry.usedAt - right.entry.usedAt);
    for (const { cache, layerId, entry } of entries) {
      if (this.cacheBytes <= MAX_ENCODED_ASSET_CACHE_BYTES) break;
      cache.delete(layerId); this.cacheBytes -= entry.blob.size;
    }
  }
}
