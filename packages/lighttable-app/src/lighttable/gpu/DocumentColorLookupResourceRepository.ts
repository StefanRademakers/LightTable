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

  get(
    key: DocumentColorLookupResourceKey,
    assetId: DocumentAssetId
  ): ColorLookupGpuAsset | null {
    return this.sets.get(key)?.get(assetId) ?? null;
  }

  release(key: DocumentColorLookupResourceKey): boolean {
    const destroy = this.detach(key);
    if (!destroy) return false;
    destroy();
    return true;
  }

  /** Detaches an exact generation now so a later fence cannot hit its replacement. */
  detach(key: DocumentColorLookupResourceKey): (() => void) | null {
    const set = this.sets.get(key);
    if (!set) return null;
    this.sets.delete(key);
    return () => {
      set.forEach(({ texture }) => texture.destroy());
      set.clear();
    };
  }

  remove(key: DocumentColorLookupResourceKey, assetId: DocumentAssetId): boolean {
    const set = this.sets.get(key);
    const asset = set?.get(assetId);
    if (!set || !asset) return false;
    asset.texture.destroy();
    set.delete(assetId);
    return true;
  }

  prune(
    key: DocumentColorLookupResourceKey,
    keepAssetIds: ReadonlySet<DocumentAssetId>
  ): void {
    const set = this.sets.get(key);
    if (!set) return;
    for (const [assetId, asset] of set) {
      if (keepAssetIds.has(assetId)) continue;
      asset.texture.destroy();
      set.delete(assetId);
    }
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
