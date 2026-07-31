import type { DocumentAssetId } from '../document/documentTypes';

interface PatternRuntimeAsset {
  source: Blob;
  texture: GPUTexture;
}

/**
 * Owns immutable pattern sources and their decoded GPU textures as one unit.
 * Replacing a stable asset id is atomic from the renderer's perspective and
 * always releases the previous texture.
 */
export class PatternAssetStore {
  private readonly assets = new Map<DocumentAssetId, PatternRuntimeAsset>();

  getTexture(id: DocumentAssetId) {
    return this.assets.get(id)?.texture ?? null;
  }

  getSource(id: DocumentAssetId) {
    return this.assets.get(id)?.source ?? null;
  }

  set(id: DocumentAssetId, source: Blob, texture: GPUTexture) {
    const previous = this.assets.get(id);
    if (previous?.texture !== texture) previous?.texture.destroy();
    this.assets.set(id, { source, texture });
  }

  estimatedTextureBytes() {
    let bytes = 0;
    this.assets.forEach(({ texture }) => {
      bytes += Math.max(1, texture.width) * Math.max(1, texture.height) * 8;
    });
    return bytes;
  }

  clear() {
    this.assets.forEach(({ texture }) => texture.destroy());
    this.assets.clear();
  }

  destroy() {
    this.clear();
  }
}
