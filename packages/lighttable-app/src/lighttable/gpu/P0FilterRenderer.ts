import {
  BlurCore,
  MorphologyCore,
  MotionBlurCore,
  OffsetCore,
  WaveletDenoiseCore,
  type BlurCoreMode
} from '@lighttable/filter-webgpu';
import { p0FilterDefinitionForModule, type P0FilterSettingsMap } from '@lighttable/filter-core';
import type { AdjustmentLayer, RasterLayer } from '../editor/document/documentTypes';
import { p0FilterModule, p0FilterSettings } from '../processing/p0Filter';

const BLUR_CORE_MODES = new Set<BlurCoreMode>([
  'gaussian-blur', 'high-pass', 'unsharp-mask', 'smart-sharpen'
]);

/**
 * Executes canonical P0 filter nodes without knowing whether their owner is a
 * standalone filter layer or an attached raster-processing node.
 */
export class P0FilterRenderer {
  private readonly blurCore: BlurCore;
  private readonly offsetCore: OffsetCore;
  private readonly motionBlurCore: MotionBlurCore;
  private readonly morphologyCore: MorphologyCore;
  private readonly waveletDenoiseCore: WaveletDenoiseCore;

  constructor(device: GPUDevice) {
    this.blurCore = new BlurCore(device);
    this.offsetCore = new OffsetCore(device);
    this.motionBlurCore = new MotionBlurCore(device);
    this.morphologyCore = new MorphologyCore(device);
    this.waveletDenoiseCore = new WaveletDenoiseCore(device);
  }

  configure(width: number, height: number, sampler: GPUSampler): void {
    this.blurCore.configure(width, height, sampler);
    this.offsetCore.configure(width, height);
    this.motionBlurCore.configure(width, height, sampler);
    this.morphologyCore.configure(width, height);
    this.waveletDenoiseCore.configure(width, height, sampler);
  }

  encode(
    encoder: GPUCommandEncoder,
    source: GPUTexture,
    layer: AdjustmentLayer | RasterLayer
  ): GPUTexture {
    const module = p0FilterModule(layer.adjustmentStack);
    const definition = p0FilterDefinitionForModule(module?.type ?? '');
    if (!module?.enabled || !definition) {
      return source;
    }
    if (definition.kind === 'offset') {
      const settings = p0FilterSettings(layer.adjustmentStack, 'offset');
      return settings ? this.offsetCore.encode(encoder, source, {
        key: `${layer.id}::${module.id}`, revision: module.revision, settings
      }) : source;
    }
    if (definition.kind === 'motion-blur') {
      const settings = p0FilterSettings(layer.adjustmentStack, 'motion-blur');
      return settings ? this.motionBlurCore.encode(encoder, source, {
        key: `${layer.id}::${module.id}`, revision: module.revision,
        mode: 'motion-blur', settings
      }) : source;
    }
    if (definition.kind === 'smart-sharpen') {
      const settings = p0FilterSettings(layer.adjustmentStack, 'smart-sharpen');
      if (!settings) return source;
      if (settings.remove === 'motion') {
        return this.motionBlurCore.encode(encoder, source, {
          key: `${layer.id}::${module.id}`, revision: module.revision,
          mode: 'smart-sharpen', settings
        });
      }
    }
    if (definition.kind === 'maximum' || definition.kind === 'minimum') {
      const settings = p0FilterSettings(layer.adjustmentStack, definition.kind);
      return settings ? this.morphologyCore.encode(encoder, source, {
        key: `${layer.id}::${module.id}`,
        revision: module.revision,
        mode: definition.kind,
        settings
      }) : source;
    }
    if (definition.kind === 'reduce-noise') {
      const settings = p0FilterSettings(layer.adjustmentStack, 'reduce-noise');
      return settings ? this.waveletDenoiseCore.encode(encoder, source, {
        key: `${layer.id}::${module.id}`, revision: module.revision, settings
      }) : source;
    }
    if (!BLUR_CORE_MODES.has(definition.kind as BlurCoreMode)) return source;
    const mode = definition.kind as BlurCoreMode;
    const settings = p0FilterSettings(layer.adjustmentStack, mode);
    if (!settings) return source;
    return this.blurCore.encode(encoder, source, {
      key: `${layer.id}::${module.id}`,
      revision: module.revision,
      mode,
      settings: settings as P0FilterSettingsMap[typeof mode]
    });
  }

  estimatedTextureBytes(): number {
    return this.blurCore.estimatedTextureBytes() + this.offsetCore.estimatedTextureBytes()
      + this.motionBlurCore.estimatedTextureBytes()
      + this.morphologyCore.estimatedTextureBytes()
      + this.waveletDenoiseCore.estimatedTextureBytes();
  }

  reset(): void {
    this.blurCore.destroy();
    this.offsetCore.destroy();
    this.motionBlurCore.destroy();
    this.morphologyCore.destroy();
    this.waveletDenoiseCore.destroy();
  }

  destroy(): void {
    this.blurCore.destroy();
    this.offsetCore.destroy();
    this.motionBlurCore.destroy();
    this.morphologyCore.destroy();
    this.waveletDenoiseCore.destroy();
  }
}
