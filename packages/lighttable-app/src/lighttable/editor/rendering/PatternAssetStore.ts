import type { DocumentAssetId } from '../document/documentTypes';
import {
  DocumentPatternResourceRepository,
  type DocumentPatternResourceKey
} from './DocumentPatternResourceRepository';

/**
 * Owns immutable pattern sources and their decoded GPU textures as one unit.
 * Replacing a stable asset id is atomic from the renderer's perspective and
 * always releases the previous texture.
 */
export class PatternAssetStore {
  private readonly repository: DocumentPatternResourceRepository;
  private resourceKey: DocumentPatternResourceKey;
  private readonly releaseOnDestroy: boolean;

  constructor(
    repository?: DocumentPatternResourceRepository,
    resourceKey: DocumentPatternResourceKey = Symbol('standalone-pattern-resources')
  ) {
    this.repository = repository ?? new DocumentPatternResourceRepository();
    this.resourceKey = resourceKey;
    this.releaseOnDestroy = repository === undefined;
  }

  private get assets() {
    return this.repository.acquire(this.resourceKey);
  }

  bind(resourceKey: DocumentPatternResourceKey): boolean {
    const existed = this.repository.has(resourceKey);
    if (this.releaseOnDestroy && resourceKey !== this.resourceKey) {
      this.repository.release(this.resourceKey);
    }
    this.resourceKey = resourceKey;
    this.repository.acquire(resourceKey);
    return !this.releaseOnDestroy && existed;
  }

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
    if (this.releaseOnDestroy) this.repository.release(this.resourceKey);
  }

  destroy() {
    this.clear();
  }
}
