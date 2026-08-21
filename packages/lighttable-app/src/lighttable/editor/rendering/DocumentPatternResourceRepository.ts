import type { DocumentAssetId } from '../document/documentTypes';

export interface PatternRuntimeAsset {
  source: Blob;
  texture: GPUTexture;
}

export type DocumentPatternResourceKey = string | symbol;

export class DocumentPatternResourceRepository {
  private readonly sets = new Map<
    DocumentPatternResourceKey,
    Map<DocumentAssetId, PatternRuntimeAsset>
  >();

  has(key: DocumentPatternResourceKey): boolean {
    return this.sets.has(key);
  }

  acquire(key: DocumentPatternResourceKey): Map<DocumentAssetId, PatternRuntimeAsset> {
    const existing = this.sets.get(key);
    if (existing) return existing;
    const created = new Map<DocumentAssetId, PatternRuntimeAsset>();
    this.sets.set(key, created);
    return created;
  }

  release(key: DocumentPatternResourceKey): boolean {
    const set = this.sets.get(key);
    if (!set) return false;
    set.forEach(({ texture }) => texture.destroy());
    set.clear();
    this.sets.delete(key);
    return true;
  }
}

const repositoriesByDevice = new WeakMap<GPUDevice, DocumentPatternResourceRepository>();

export const documentPatternResourceRepositoryFor = (
  device: GPUDevice
): DocumentPatternResourceRepository => {
  const existing = repositoriesByDevice.get(device);
  if (existing) return existing;
  const created = new DocumentPatternResourceRepository();
  repositoriesByDevice.set(device, created);
  return created;
};
