import type { DocumentAssetId } from '../editor/document/documentTypes';
import type { ColorLookupGpuAsset } from './ColorLookupAssetStore';

export type DocumentColorLookupResourceKey = string | symbol;

export class DocumentColorLookupResourceRepository {
  private readonly sets = new Map<
    DocumentColorLookupResourceKey,
    Map<DocumentAssetId, ColorLookupGpuAsset>
  >();

  has(key: DocumentColorLookupResourceKey): boolean {
    return this.sets.has(key);
  }

  acquire(key: DocumentColorLookupResourceKey): Map<DocumentAssetId, ColorLookupGpuAsset> {
    const existing = this.sets.get(key);
    if (existing) return existing;
    const created = new Map<DocumentAssetId, ColorLookupGpuAsset>();
    this.sets.set(key, created);
    return created;
  }

  release(key: DocumentColorLookupResourceKey): boolean {
    const set = this.sets.get(key);
    if (!set) return false;
    set.forEach(({ texture }) => texture.destroy());
    set.clear();
    this.sets.delete(key);
    return true;
  }
}

const repositoriesByDevice = new WeakMap<GPUDevice, DocumentColorLookupResourceRepository>();

export const documentColorLookupResourceRepositoryFor = (
  device: GPUDevice
): DocumentColorLookupResourceRepository => {
  const existing = repositoriesByDevice.get(device);
  if (existing) return existing;
  const created = new DocumentColorLookupResourceRepository();
  repositoriesByDevice.set(device, created);
  return created;
};
