import type { LayerId } from '../document/documentTypes';

export interface LayerThumbnailBlob {
  blob: Blob;
  width: number;
  height: number;
}

export interface LayerThumbnailServiceOptions {
  dimensions: () => { width: number; height: number };
  layerSource: (layerId: LayerId) => {
    texture: GPUTexture;
    width: number;
    height: number;
    revisionKey?: string;
  } | null;
  maskTexture: (layerId: LayerId) => GPUTexture | null;
  encode: (
    source: GPUTexture,
    maskChannel: boolean,
    width: number,
    height: number
  ) => Promise<Blob>;
}

/**
 * Produces cached-presentation assets without exposing renderer stores or
 * document-sized GPU readbacks to UI code.
 */
export class LayerThumbnailService {
  constructor(private readonly options: LayerThumbnailServiceOptions) {}

  async export(
    layerId: LayerId,
    maskChannel = false,
    maximumWidth = 80,
    maximumHeight = 80
  ): Promise<LayerThumbnailBlob | null> {
    const { width: documentWidth, height: documentHeight } = this.options.dimensions();
    const source = maskChannel
      ? (() => {
          const texture = this.options.maskTexture(layerId);
          return texture ? { texture, width: documentWidth, height: documentHeight } : null;
        })()
      : this.options.layerSource(layerId);
    if (!source || source.width < 1 || source.height < 1) return null;

    const scale = Math.min(
      Math.max(1, maximumWidth) / source.width,
      Math.max(1, maximumHeight) / source.height,
      1
    );
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));
    const blob = await this.options.encode(source.texture, maskChannel, width, height);
    return { blob, width, height };
  }
}
