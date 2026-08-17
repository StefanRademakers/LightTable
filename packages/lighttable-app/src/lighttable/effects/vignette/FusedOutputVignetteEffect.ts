import type { DocumentGpuEffect } from '../documentEffectNodeRegistry';

/**
 * Semantic executor for the post-crop Vignette node.
 *
 * Pixel work is deliberately fused into the document output transform. This
 * retained executor keeps the serialized effect graph ordered before Grain
 * without allocating a target or adding another fullscreen pass.
 */
export class FusedOutputVignetteEffect implements DocumentGpuEffect {
  readonly id = 'post-crop-vignette';
  readonly stage = 'display-post' as const;

  resize(): void {}

  encode(_encoder: GPUCommandEncoder, input: GPUTexture): GPUTexture {
    return input;
  }

  destroyImageResources(): void {}

  destroy(): void {}

  estimatedTextureBytes(): number {
    return 0;
  }
}
