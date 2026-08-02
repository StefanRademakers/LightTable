import type {
  DocumentAssetId,
  ImageDocument,
  LayerId
} from '../document/documentTypes';
import {
  walkLayerTree,
  walkRasterLayers
} from '../document/layerTree';
import type {
  DocumentAssetBlob,
  PatternAssetBlob
} from '../persistence/layeredDocumentFormat';

export interface LayerDocumentAssetPorts {
  rasterTexture: (layerId: LayerId) => GPUTexture | null;
  maskTexture: (layerId: LayerId) => GPUTexture | null;
  encodeTexture: (texture: GPUTexture, maskChannel: boolean) => Promise<Blob>;
  decodeTexture: (blob: Blob, texture: GPUTexture, maskChannel: boolean) => Promise<void>;
  invalidateLayer: (layerId: LayerId) => void;
  patternSource: (patternId: DocumentAssetId) => Blob | null;
  loadPattern: (asset: PatternAssetBlob) => Promise<void>;
}

/**
 * Owns layered-document asset transfer policy without owning GPU resources.
 *
 * The renderer supplies narrow texture and codec ports. This service decides
 * which canonical document nodes participate in save/reopen, keeping binary
 * persistence orchestration separate from interactive compositing.
 */
export class LayerDocumentAssetService {
  constructor(private readonly ports: LayerDocumentAssetPorts) {}

  async export(document: ImageDocument): Promise<DocumentAssetBlob[]> {
    const assets: DocumentAssetBlob[] = [];
    for (const { layer } of walkRasterLayers(document.layers)) {
      const texture = this.ports.rasterTexture(layer.id);
      if (!texture) throw new Error(`Layer ${layer.name} is not available for saving.`);
      const maskTexture = layer.mask ? this.ports.maskTexture(layer.id) : null;
      assets.push({
        layerId: layer.id,
        pixels: await this.ports.encodeTexture(texture, false),
        mask: maskTexture ? await this.ports.encodeTexture(maskTexture, true) : null
      });
    }

    for (const { node } of walkLayerTree(document.layers)) {
      if (node.type === 'raster' || !node.mask) continue;
      const maskTexture = this.ports.maskTexture(node.id);
      if (!maskTexture) throw new Error(`Mask ${node.name} is not available for saving.`);
      assets.push({
        layerId: node.id,
        pixels: new Blob(),
        mask: await this.ports.encodeTexture(maskTexture, true)
      });
    }

    for (const pattern of document.assets.patterns) {
      const source = this.ports.patternSource(pattern.id);
      if (!source) throw new Error(`Pattern ${pattern.name} is not available for saving.`);
      assets.push({ patternId: pattern.id, source });
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
      if (asset.pixels.size > 0) {
        const texture = this.ports.rasterTexture(asset.layerId);
        if (!texture) {
          throw new Error(`Layer ${asset.layerId} is not available while opening the document.`);
        }
        await this.ports.decodeTexture(asset.pixels, texture, false);
      }
      if (asset.mask) {
        const maskTexture = this.ports.maskTexture(asset.layerId);
        if (!maskTexture) {
          throw new Error(`Mask ${asset.layerId} is not available while opening the document.`);
        }
        await this.ports.decodeTexture(asset.mask, maskTexture, true);
      }
    }
  }
}
