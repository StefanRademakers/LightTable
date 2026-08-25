import {
  BlurCore,
  MorphologyCore,
  MotionBlurCore,
  OffsetCore,
  type BlurCoreMode
} from '@lighttable/filter-webgpu';
import { p0FilterDefinitionForModule, type P0FilterSettingsMap } from '@lighttable/filter-core';
import type { AdjustmentLayer, RasterLayer } from '../editor/document/documentTypes';
import { p0FilterModule, p0FilterSettings } from '../processing/p0Filter';

const BLUR_CORE_MODES = new Set<BlurCoreMode>([
  'gaussian-blur', 'high-pass', 'unsharp-mask'
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

  constructor(device: GPUDevice) {
    this.blurCore = new BlurCore(device);
    this.offsetCore = new OffsetCore(device);
    this.motionBlurCore = new MotionBlurCore(device);
    this.morphologyCore = new MorphologyCore(device);
  }

  configure(width: number, height: number, sampler: GPUSampler): void {
    this.blurCore.configure(width, height, sampler);
    this.offsetCore.configure(width, height);
    this.motionBlurCore.configure(width, height, sampler);
    this.morphologyCore.configure(width, height);
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
        key: `${layer.id}::${module.id}`, revision: module.revision, settings
      }) : source;
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
      + this.morphologyCore.estimatedTextureBytes();
  }

  reset(): void {
    this.blurCore.destroy();
    this.offsetCore.destroy();
    this.motionBlurCore.destroy();
    this.morphologyCore.destroy();
  }

  destroy(): void {
    this.blurCore.destroy();
    this.offsetCore.destroy();
    this.motionBlurCore.destroy();
    this.morphologyCore.destroy();
  }
}
