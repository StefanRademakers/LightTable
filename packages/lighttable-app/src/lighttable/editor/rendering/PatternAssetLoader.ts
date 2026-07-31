import { decodeNativeImage } from '../../image-io/NativeImageDecoder';
import type { NativeDecodedImage } from '../../image-io/types';
import type { PatternAssetBlob } from '../persistence/layeredDocumentFormat';
import type { PatternAssetStore } from './PatternAssetStore';

interface PatternAssetLoaderOptions {
  device: GPUDevice;
  sampler: GPUSampler;
  decodePipeline: GPURenderPipeline;
  store: PatternAssetStore;
  generation: () => number;
  invalidateStyledLayers: () => void;
  drawFullscreen: (
    encoder: GPUCommandEncoder,
    pipeline: GPURenderPipeline,
    bindGroup: GPUBindGroup,
    target: GPUTextureView,
    clearValue: GPUColor
  ) => void;
  decodeImage?: (source: Blob) => Promise<NativeDecodedImage>;
}

const patternTextureUsage = () => GPUTextureUsage.TEXTURE_BINDING |
  GPUTextureUsage.RENDER_ATTACHMENT |
  GPUTextureUsage.COPY_SRC |
  GPUTextureUsage.COPY_DST;

/**
 * Restores immutable document patterns into linear GPU textures.
 *
 * Decode is asynchronous, so every publication is guarded by the document
 * resource generation. A stale load may finish decoding, but can never publish
 * into a replacement document.
 */
export class PatternAssetLoader {
  private readonly decodeImage: (source: Blob) => Promise<NativeDecodedImage>;

  constructor(private readonly options: PatternAssetLoaderOptions) {
    this.decodeImage = options.decodeImage ?? decodeNativeImage;
  }

  async load(asset: PatternAssetBlob) {
    // Replacing one stable pattern id can affect any styled-layer cache.
    this.options.invalidateStyledLayers();
    const generation = this.options.generation();
    const decoded = await this.decodeImage(asset.source);
    const { bitmap } = decoded;
    let encodedTexture: GPUTexture | null = null;
    let target: GPUTexture | null = null;
    try {
      if (generation !== this.options.generation()) {
        throw new Error('LightTable was closed while restoring its patterns.');
      }
      encodedTexture = this.options.device.createTexture({
        label: 'LightTable persisted pattern source',
        size: [bitmap.width, bitmap.height],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
      });
      target = this.options.device.createTexture({
        label: `LightTable pattern: ${asset.patternId}`,
        size: [bitmap.width, bitmap.height],
        format: 'rgba16float',
        usage: patternTextureUsage()
      });
      this.options.device.queue.copyExternalImageToTexture(
        { source: bitmap },
        { texture: encodedTexture },
        [bitmap.width, bitmap.height]
      );
      const bindGroup = this.options.device.createBindGroup({
        layout: this.options.decodePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: encodedTexture.createView() },
          { binding: 1, resource: this.options.sampler }
        ]
      });
      const encoder = this.options.device.createCommandEncoder({
        label: 'Restore LightTable pattern pixels'
      });
      this.options.drawFullscreen(
        encoder,
        this.options.decodePipeline,
        bindGroup,
        target.createView(),
        { r: 0, g: 0, b: 0, a: 0 }
      );
      this.options.device.queue.submit([encoder.finish()]);
      await this.options.device.queue.onSubmittedWorkDone();
      if (generation !== this.options.generation()) {
        throw new Error('LightTable was closed while restoring its patterns.');
      }
      this.options.store.set(asset.patternId, asset.source, target);
      target = null;
    } finally {
      encodedTexture?.destroy();
      target?.destroy();
      decoded.close();
    }
  }
}
