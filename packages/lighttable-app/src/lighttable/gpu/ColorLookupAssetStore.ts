import type { DocumentAssetId } from '../editor/document/documentTypes';
import type { ColorLookupAssetBlob } from '../editor/persistence/layeredDocumentFormat';
import { cubeRgbaValues, parseCubeLut } from '../processing/colorLookupCube';

export interface ColorLookupGpuAsset {
  readonly source: Blob;
  readonly texture: GPUTexture;
  readonly size: number;
  readonly domainMin: readonly [number, number, number];
  readonly domainMax: readonly [number, number, number];
}

/** Owns embedded .cube bytes and their document-scoped 3D GPU realizations. */
export class ColorLookupAssetStore {
  private readonly assets = new Map<DocumentAssetId, ColorLookupGpuAsset>();

  constructor(private readonly device: GPUDevice) {}

  get(id: string | null): ColorLookupGpuAsset | null {
    return id ? this.assets.get(id as DocumentAssetId) ?? null : null;
  }

  getSource(id: DocumentAssetId): Blob | null {
    return this.assets.get(id)?.source ?? null;
  }

  async load(asset: ColorLookupAssetBlob): Promise<ColorLookupGpuAsset> {
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
      const previous = this.assets.get(asset.lutId);
      this.assets.set(asset.lutId, runtime);
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
    this.assets.forEach(({ texture }) => texture.destroy());
    this.assets.clear();
  }
}
