import {
  BlurCore,
  DisplaceCore,
  FilterTargetPool,
  MorphologyCore,
  MotionBlurCore,
  MedianCore,
  OffsetCore,
  P1FilterExecutor,
  P2FilterExecutor,
  SurfaceBlurCore,
  WaveletDenoiseCore,
  type BlurCoreMode,
  type FilterPackExecutor
} from '@lighttable/filter-webgpu';
import {
  ACTIVE_FILTER_PACKS,
  filterDefinitionForModule,
  type P0FilterSettingsMap
} from '@lighttable/filter-core';
import type {
  AdjustmentLayer,
  ImageDocument,
  LayerNode,
  RasterLayer
} from '../editor/document/documentTypes';
import { attachedAdjustmentOwnerId } from '../processing/attachedAdjustment';
import { filterModule, filterSettings } from '../processing/filter';

const BLUR_CORE_MODES = new Set<BlurCoreMode>([
  'gaussian-blur', 'high-pass', 'unsharp-mask', 'smart-sharpen'
]);

/**
 * Executes canonical active-pack filter nodes without knowing whether their owner is a
 * standalone filter layer or an attached raster-processing node.
 */
export class P0FilterRenderer {
  private readonly targetPool: FilterTargetPool;
  private readonly blurCore: BlurCore;
  private readonly offsetCore: OffsetCore;
  private readonly motionBlurCore: MotionBlurCore;
  private readonly morphologyCore: MorphologyCore;
  private readonly waveletDenoiseCore: WaveletDenoiseCore;
  private readonly displaceCore: DisplaceCore;
  private readonly surfaceBlurCore: SurfaceBlurCore;
  private readonly medianCore: MedianCore;
  private readonly extensionExecutors: readonly FilterPackExecutor[];
  private sampler: GPUSampler | null = null;

  constructor(device: GPUDevice,
    private readonly resolveRasterTexture: (id: string) => GPUTexture | null = () => null) {
    this.targetPool = new FilterTargetPool(device, 3);
    this.blurCore = new BlurCore(device, this.targetPool);
    this.offsetCore = new OffsetCore(device, this.targetPool);
    this.motionBlurCore = new MotionBlurCore(device, this.targetPool);
    this.morphologyCore = new MorphologyCore(device, this.targetPool);
    this.waveletDenoiseCore = new WaveletDenoiseCore(device, this.targetPool);
    this.displaceCore = new DisplaceCore(device, this.targetPool);
    this.surfaceBlurCore = new SurfaceBlurCore(device, this.targetPool);
    this.medianCore = new MedianCore(device, this.targetPool);
    this.extensionExecutors = ACTIVE_FILTER_PACKS.flatMap((pack): FilterPackExecutor[] => {
      if (pack.id === 'p1') return [new P1FilterExecutor(device, this.targetPool)];
      if (pack.id === 'p2') return [new P2FilterExecutor(device, this.targetPool)];
      return [];
    });
  }

  configure(width: number, height: number, sampler: GPUSampler): void {
    this.sampler = sampler;
    this.blurCore.configure(width, height, sampler);
    this.offsetCore.configure(width, height);
    this.motionBlurCore.configure(width, height, sampler);
    this.morphologyCore.configure(width, height);
    this.waveletDenoiseCore.configure(width, height, sampler);
    this.displaceCore.configure(width, height);
    this.surfaceBlurCore.configure(width, height, sampler);
    this.medianCore.configure(width, height);
    this.extensionExecutors.forEach((executor) => executor.configure(width, height, sampler));
  }

  encode(
    encoder: GPUCommandEncoder,
    source: GPUTexture,
    layer: AdjustmentLayer | RasterLayer
  ): GPUTexture {
    const module = filterModule(layer.adjustmentStack);
    const definition = filterDefinitionForModule(module?.type ?? '');
    if (!module?.enabled || !definition) {
      return source;
    }
    const key = `${layer.id}::${module.id}`;
    const extension = this.extensionExecutors.find((executor) => executor.supports(definition.kind));
    if (extension) {
      const settings = filterSettings(layer.adjustmentStack, definition.kind);
      return settings ? extension.encode({
        encoder,
        source,
        key,
        revision: module.revision,
        kind: definition.kind,
        settings
      }) : source;
    }
    if (definition.kind === 'offset') {
      const settings = filterSettings(layer.adjustmentStack, 'offset');
      return settings ? this.offsetCore.encode(encoder, source, {
        key: `${layer.id}::${module.id}`, revision: module.revision, settings
      }) : source;
    }
    if (definition.kind === 'motion-blur') {
      const settings = filterSettings(layer.adjustmentStack, 'motion-blur');
      return settings ? this.motionBlurCore.encode(encoder, source, {
        key: `${layer.id}::${module.id}`, revision: module.revision,
        mode: 'motion-blur', settings
      }) : source;
    }
    if (definition.kind === 'smart-sharpen') {
      const settings = filterSettings(layer.adjustmentStack, 'smart-sharpen');
      if (!settings) return source;
      if (settings.remove === 'motion') {
        return this.motionBlurCore.encode(encoder, source, {
          key: `${layer.id}::${module.id}`, revision: module.revision,
          mode: 'smart-sharpen', settings
        });
      }
    }
    if (definition.kind === 'maximum' || definition.kind === 'minimum') {
      const settings = filterSettings(layer.adjustmentStack, definition.kind);
      return settings ? this.morphologyCore.encode(encoder, source, {
        key: `${layer.id}::${module.id}`,
        revision: module.revision,
        mode: definition.kind,
        settings
      }) : source;
    }
    if (definition.kind === 'reduce-noise') {
      const settings = filterSettings(layer.adjustmentStack, 'reduce-noise');
      return settings ? this.waveletDenoiseCore.encode(encoder, source, {
        key: `${layer.id}::${module.id}`, revision: module.revision, settings
      }) : source;
    }
    if (definition.kind === 'displace') {
      const settings = filterSettings(layer.adjustmentStack, 'displace');
      const map = settings?.mapAssetId ? this.resolveRasterTexture(settings.mapAssetId) : null;
      return settings && map && this.sampler ? this.displaceCore.encode(
        encoder, source, map, this.sampler, {
          key: `${layer.id}::${module.id}`,
          revision: module.revision,
          settings
        }
      ) : source;
    }
    if (definition.kind === 'surface-blur') {
      const settings = filterSettings(layer.adjustmentStack, 'surface-blur');
      return settings ? this.surfaceBlurCore.encode(encoder, source, {
        key: `${layer.id}::${module.id}`, revision: module.revision, settings
      }) : source;
    }
    if (definition.kind === 'median') {
      const settings = filterSettings(layer.adjustmentStack, 'median');
      return settings ? this.medianCore.encode(encoder, source, {
        key: `${layer.id}::${module.id}`, revision: module.revision, settings
      }) : source;
    }
    if (!BLUR_CORE_MODES.has(definition.kind as BlurCoreMode)) return source;
    const mode = definition.kind as BlurCoreMode;
    const settings = filterSettings(layer.adjustmentStack, mode);
    if (!settings) return source;
    return this.blurCore.encode(encoder, source, {
      key: `${layer.id}::${module.id}`,
      revision: module.revision,
      mode,
      settings: settings as P0FilterSettingsMap[typeof mode]
    });
  }

  /** Drops keyed GPU buffers as soon as their document owner disappears. */
  syncDocument(document: ImageDocument): void {
    const activeKeys = new Set<string>();
    const collect = (ownerId: string, stack: AdjustmentLayer['adjustmentStack'] | null) => {
      const module = filterModule(stack);
      if (module && filterDefinitionForModule(module.type)) {
        activeKeys.add(`${ownerId}::${module.id}`);
      }
    };
    const visit = (layer: LayerNode) => {
      if (layer.type === 'group') {
        layer.children.forEach(visit);
        return;
      }
      if (layer.type === 'adjustment') collect(layer.id, layer.adjustmentStack);
      if (layer.type !== 'raster') return;
      collect(layer.id, layer.adjustmentStack);
      for (const adjustment of layer.attachedAdjustments ?? []) {
        collect(attachedAdjustmentOwnerId(layer.id, adjustment.id), adjustment.adjustmentStack);
      }
    };
    document.layers.forEach(visit);
    this.blurCore.releaseInactive(activeKeys);
    this.offsetCore.releaseInactive(activeKeys);
    this.motionBlurCore.releaseInactive(activeKeys);
    this.morphologyCore.releaseInactive(activeKeys);
    this.waveletDenoiseCore.releaseInactive(activeKeys);
    this.displaceCore.releaseInactive(activeKeys);
    this.surfaceBlurCore.releaseInactive(activeKeys);
    this.medianCore.releaseInactive(activeKeys);
    this.extensionExecutors.forEach((executor) => executor.releaseInactive(activeKeys));
  }

  estimatedTextureBytes(): number {
    return this.targetPool.estimatedTextureBytes()
      + this.blurCore.estimatedTextureBytes() + this.offsetCore.estimatedTextureBytes()
      + this.motionBlurCore.estimatedTextureBytes()
      + this.morphologyCore.estimatedTextureBytes()
      + this.waveletDenoiseCore.estimatedTextureBytes()
      + this.displaceCore.estimatedTextureBytes()
      + this.surfaceBlurCore.estimatedTextureBytes()
      + this.medianCore.estimatedTextureBytes();
  }

  reset(): void {
    this.blurCore.destroy();
    this.offsetCore.destroy();
    this.motionBlurCore.destroy();
    this.morphologyCore.destroy();
    this.waveletDenoiseCore.destroy();
    this.displaceCore.destroy();
    this.surfaceBlurCore.destroy();
    this.medianCore.destroy();
    this.extensionExecutors.forEach((executor) => executor.destroy());
    this.targetPool.destroy();
  }

  destroy(): void {
    this.blurCore.destroy();
    this.offsetCore.destroy();
    this.motionBlurCore.destroy();
    this.morphologyCore.destroy();
    this.waveletDenoiseCore.destroy();
    this.displaceCore.destroy();
    this.surfaceBlurCore.destroy();
    this.medianCore.destroy();
    this.extensionExecutors.forEach((executor) => executor.destroy());
    this.targetPool.destroy();
  }
}
