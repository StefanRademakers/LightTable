import type { LayerId } from '../document/documentTypes';
import { transformedBounds, type AffineMatrix } from '../geometry/affine';

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
    /** Maps source texture pixels into document space. */
    transform?: AffineMatrix;
  } | null;
  maskTexture: (layerId: LayerId) => GPUTexture | null;
  encode: (
    source: GPUTexture,
    maskChannel: boolean,
    width: number,
    height: number,
    sourceToOutput?: AffineMatrix
  ) => Promise<Blob>;
}

type LayerThumbnailSource = NonNullable<
  ReturnType<LayerThumbnailServiceOptions['layerSource']>
>;

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
    const source: LayerThumbnailSource | null = maskChannel
      ? (() => {
          const texture = this.options.maskTexture(layerId);
          return texture
            ? { texture, width: documentWidth, height: documentHeight }
            : null;
        })()
      : this.options.layerSource(layerId);
    if (!source || source.width < 1 || source.height < 1) return null;

    const transformed = source.transform
      ? transformedBounds(source.transform, {
          x: 0,
          y: 0,
          width: source.width,
          height: source.height
        })
      : { x: 0, y: 0, width: source.width, height: source.height };
    if (transformed.width <= 0 || transformed.height <= 0) return null;
    const scale = Math.min(
      Math.max(1, maximumWidth) / transformed.width,
      Math.max(1, maximumHeight) / transformed.height,
      1
    );
    const width = Math.max(1, Math.round(transformed.width * scale));
    const height = Math.max(1, Math.round(transformed.height * scale));
    const sourceToOutput = source.transform ? {
      a: source.transform.a * scale,
      b: source.transform.b * scale,
      c: source.transform.c * scale,
      d: source.transform.d * scale,
      tx: (source.transform.tx - transformed.x) * scale,
      ty: (source.transform.ty - transformed.y) * scale
    } : undefined;
    const blob = sourceToOutput
      ? await this.options.encode(
          source.texture,
          maskChannel,
          width,
          height,
          sourceToOutput
        )
      : await this.options.encode(source.texture, maskChannel, width, height);
    return { blob, width, height };
  }
}
