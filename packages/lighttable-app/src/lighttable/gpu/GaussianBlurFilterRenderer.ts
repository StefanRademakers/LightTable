import { BlurCore } from '@lighttable/filter-webgpu';
import type { AdjustmentLayer, RasterLayer } from '../editor/document/documentTypes';
import { gaussianBlurModule, gaussianBlurSettings } from '../processing/gaussianBlurFilter';

/**
 * Full-resolution separable Gaussian filter in premultiplied linear RGBA.
 *
 * The filter owns only GPU execution resources. The canonical module remains
 * in the document stack; the compositor remains responsible for its mask,
 * clipping, opacity and blend semantics.
 */
export class GaussianBlurFilterRenderer {
  private readonly blurCore: BlurCore;

  constructor(device: GPUDevice) {
    this.blurCore = new BlurCore(device);
  }

  configure(
    width: number,
    height: number,
    sampler: GPUSampler
  ): void {
    this.blurCore.configure(width, height, sampler);
  }

  encode(
    encoder: GPUCommandEncoder,
    source: GPUTexture,
    layer: AdjustmentLayer | RasterLayer
  ): GPUTexture {
    const module = gaussianBlurModule(layer.adjustmentStack);
    const settings = gaussianBlurSettings(layer.adjustmentStack);
    if (!module?.enabled || !settings || settings.radius <= 0) return source;
    return this.blurCore.encode(encoder, source, {
      key: `${layer.id}::${module.id}`,
      revision: module.revision,
      mode: 'gaussian-blur',
      settings
    });
  }

  estimatedTextureBytes(): number {
    return this.blurCore.estimatedTextureBytes();
  }

  destroy(): void {
    this.blurCore.destroy();
  }

  reset(): void {
    this.blurCore.destroy();
  }
}
