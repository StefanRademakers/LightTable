import type { DocumentAssetId } from '../editor/document/documentTypes';
import type { ColorLookupAssetBlob } from '../editor/persistence/layeredDocumentFormat';
import { cubeRgbaValues, parseCubeLut } from '../processing/colorLookupCube';
import {
  DocumentColorLookupResourceRepository,
  type DocumentColorLookupResourceKey
} from './DocumentColorLookupResourceRepository';

export interface ColorLookupGpuAsset {
  readonly source: Blob;
  readonly texture: GPUTexture;
  readonly size: number;
  readonly domainMin: readonly [number, number, number];
  readonly domainMax: readonly [number, number, number];
}

/** Owns embedded .cube bytes and their document-scoped 3D GPU realizations. */
export class ColorLookupAssetStore {
  private readonly repository: DocumentColorLookupResourceRepository;
  private resourceKey: DocumentColorLookupResourceKey;
  private readonly releaseOnClear: boolean;

  constructor(
    private readonly device: GPUDevice,
    repository?: DocumentColorLookupResourceRepository,
    resourceKey: DocumentColorLookupResourceKey = Symbol('standalone-color-lookup-resources')
  ) {
    this.repository = repository ?? new DocumentColorLookupResourceRepository();
    this.resourceKey = resourceKey;
    this.releaseOnClear = repository === undefined;
  }

  private get assets() {
    return this.repository.acquire(this.resourceKey);
  }

  bind(resourceKey: DocumentColorLookupResourceKey): boolean {
    const existed = this.repository.has(resourceKey);
    if (this.releaseOnClear && resourceKey !== this.resourceKey) {
      this.repository.release(this.resourceKey);
    }
    this.resourceKey = resourceKey;
    this.repository.acquire(resourceKey);
    return !this.releaseOnClear && existed;
  }

  get(id: string | null): ColorLookupGpuAsset | null {
    return id ? this.assets.get(id as DocumentAssetId) ?? null : null;
  }

  getSource(
    id: DocumentAssetId,
    resourceKey: DocumentColorLookupResourceKey = this.resourceKey
  ): Blob | null {
    return this.repository.get(resourceKey, id)?.source ?? null;
  }

  remove(
    id: DocumentAssetId,
    resourceKey: DocumentColorLookupResourceKey = this.resourceKey
  ): boolean {
    return this.repository.remove(resourceKey, id);
  }

  async load(
    asset: ColorLookupAssetBlob,
    resourceKey: DocumentColorLookupResourceKey = this.resourceKey
  ): Promise<ColorLookupGpuAsset> {
    // Capture the target set before parsing. A document switch may rebind the
    // store while source.text() is pending; that must not move this asset into
    // the newly active document.
    const assets = this.repository.acquire(resourceKey);
    const parsed = parseCubeLut(await asset.source.text());
    const texture = this.device.createTexture({
      label: `LightTable Color Lookup: ${asset.lutId}`,
      size: [parsed.size, parsed.size, parsed.size],
      dimension: '3d',
      format: 'rgba32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
    try {
      this.device.queue.writeTexture(
        { texture },
        cubeRgbaValues(parsed),
        {
          bytesPerRow: parsed.size * 4 * Float32Array.BYTES_PER_ELEMENT,
          rowsPerImage: parsed.size
        },
        { width: parsed.size, height: parsed.size, depthOrArrayLayers: parsed.size }
      );
      const runtime = {
        source: asset.source,
        texture,
        size: parsed.size,
        domainMin: parsed.domainMin,
        domainMax: parsed.domainMax
      };
      const previous = assets.get(asset.lutId);
      assets.set(asset.lutId, runtime);
      previous?.texture.destroy();
      return runtime;
    } catch (error) {
      texture.destroy();
      throw error;
    }
  }

  estimatedTextureBytes(): number {
    let bytes = 0;
    this.assets.forEach(({ size }) => { bytes += size ** 3 * 4 * Float32Array.BYTES_PER_ELEMENT; });
    return bytes;
  }

  clear(): void {
    if (this.releaseOnClear) this.repository.release(this.resourceKey);
  }
}
