import type { LayerId } from '../document/documentTypes';

export interface LayerThumbnailBlob {
  blob: Blob;
  width: number;
  height: number;
}

export interface LayerThumbnailServiceOptions {
  dimensions: () => { width: number; height: number };
  rasterTexture: (layerId: LayerId) => GPUTexture | null;
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
    const source = maskChannel
      ? this.options.maskTexture(layerId)
      : this.options.rasterTexture(layerId);
    const { width: documentWidth, height: documentHeight } = this.options.dimensions();
    if (!source || documentWidth < 1 || documentHeight < 1) return null;

    const scale = Math.min(
      Math.max(1, maximumWidth) / documentWidth,
      Math.max(1, maximumHeight) / documentHeight,
      1
    );
    const width = Math.max(1, Math.round(documentWidth * scale));
    const height = Math.max(1, Math.round(documentHeight * scale));
    const blob = await this.options.encode(source, maskChannel, width, height);
    return { blob, width, height };
  }
}
