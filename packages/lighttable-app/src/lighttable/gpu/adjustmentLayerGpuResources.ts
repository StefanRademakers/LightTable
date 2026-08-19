import { CURVE_LUT_SIZE } from '../curves';
import type {
  AdjustmentLayer,
  ImageDocument,
  LayerId,
  LayerNode,
  RasterLayer
} from '../editor/document/documentTypes';
import { ADJUSTMENT_UNIFORM_FLOATS } from './adjustmentUniform';
import { AdjustmentGpuPayloadWriter } from './AdjustmentGpuPayloadWriter';
import {
  adjustmentStackOwnerIsEnabled,
  materializeBasicAdjustments
} from '../processing/adjustmentStack';
import { attachedAdjustmentProcessingOwner } from '../processing/attachedAdjustment';
import type { ColorLookupUniform, GradeLookUniform } from './adjustmentUniform';
import {
  loadPhotoshopColorVibranceCompatibility,
  loadedPhotoshopColorVibranceCompatibility,
  PHOTOSHOP_COLOR_VIBRANCE_COLOR_SIZE,
  PHOTOSHOP_COLOR_VIBRANCE_COMPATIBILITY_SIZE
} from './photoshopColorVibranceCompatibility';

export interface AdjustmentLayerGpuRuntime {
  uniformBuffer: GPUBuffer;
  curveTexture: GPUTexture;
  creativeBindGroup: GPUBindGroup;
  createCreativeBindGroup: (source: GPUTexture, spatialInput: GPUTexture) => GPUBindGroup;
  payloadWriter: AdjustmentGpuPayloadWriter;
  colorLookupAssetId: string | null;
  colorLookupUniform: ColorLookupUniform | null;
  gradeLookAssetId: string | null;
  gradeLookUniform: GradeLookUniform | null;
  photoshopAdjustmentKind: string;
  colorVibranceOwner: 'grade' | 'photoshop-adjustment' | null;
  colorVibranceCompatibilityTexture: GPUTexture | null;
  colorVibranceColorTexture: GPUTexture | null;
}

interface ResolvedColorLookup {
  readonly texture: GPUTexture;
  readonly domainMin: readonly [number, number, number];
  readonly domainMax: readonly [number, number, number];
}

export interface AdjustmentLayerGpuDependencies {
  sampler: GPUSampler;
  creativePipeline: GPURenderPipeline;
  correctedTexture: GPUTexture;
  downsampleTexture: GPUTexture;
  identityColorLookupTexture: GPUTexture;
  photoshopColorBalanceTransferTexture: GPUTexture;
  resolveColorLookup: (id: string | null) => ResolvedColorLookup | null;
  requestRender: () => void;
  reportError: (featureId: string, message: string) => void;
}

export function collectAdjustmentLayerIds(nodes: readonly LayerNode[]): Set<LayerId> {
  const ids = new Set<LayerId>();
  const visit = (entries: readonly LayerNode[]) => {
    for (const node of entries) {
      if (
        (node.type === 'adjustment' || node.type === 'raster')
        && node.adjustmentStack
        && adjustmentStackOwnerIsEnabled(node.adjustmentStack, 'grade')
      ) ids.add(node.id);
      if (node.type === 'raster') {
        for (const adjustment of node.attachedAdjustments ?? []) {
          if (!adjustment.enabled) continue;
          const owner = attachedAdjustmentProcessingOwner(node, adjustment);
          if (adjustmentStackOwnerIsEnabled(owner.adjustmentStack!, 'grade')) ids.add(owner.id);
        }
      } else if (node.type === 'group') visit(node.children);
    }
  };
  visit(nodes);
  return ids;
}

/**
 * Owns all GPU allocations whose lifetime follows Adjustment Layers.
 *
 * The shared full-resolution work textures remain document resources; only
 * the per-layer uniforms, curve LUT and bind group live here.
 */
export class AdjustmentLayerGpuResources {
  private readonly runtimes = new Map<LayerId, AdjustmentLayerGpuRuntime>();
  private dependencies: AdjustmentLayerGpuDependencies | null = null;
  private compatibilityLoadPromise: Promise<void> | null = null;
  private compatibilityRequired = false;

  constructor(private readonly device: GPUDevice) {}

  configure(dependencies: AdjustmentLayerGpuDependencies) {
    // Bind groups capture texture views. Reconfiguration therefore starts a
    // fresh generation even when stable layer ids are reused by another doc.
    this.reset();
    this.dependencies = dependencies;
  }

  getOrCreate(layer: AdjustmentLayer | RasterLayer): AdjustmentLayerGpuRuntime {
    const photoshopAdjustment = materializeBasicAdjustments(layer.adjustmentStack!)
      .photoshopAdjustment;
    const colorLookupAssetId = photoshopAdjustment.colorLookupAssetId;
    const adjustments = materializeBasicAdjustments(layer.adjustmentStack!);
    const gradeLookAssetId = adjustments.gradeLook.assetId;
    const photoshopAdjustmentKind = photoshopAdjustment.kind;
    const nativeGradeLayer = layer.type === 'raster' || layer.adjustmentKind === 'grade';
    const colorVibranceOwner = photoshopAdjustment.kind === 'color-vibrance'
      ? 'photoshop-adjustment' as const
      : nativeGradeLayer
        ? 'grade' as const
        : null;
    const colorVibranceWhiteBalanceActive = colorVibranceOwner === 'photoshop-adjustment'
      ? Math.abs(photoshopAdjustment.colorVibranceTemperature) > 0.00001
        || Math.abs(photoshopAdjustment.colorVibranceTint) > 0.00001
      : colorVibranceOwner === 'grade'
        && (Math.abs(adjustments.temperature) > 0.00001 || Math.abs(adjustments.tint) > 0.00001);
    // Warm the external volumes when a native Grade layer is first realized.
    // Waiting for the first T/T gesture lets its first frame and an immediate
    // export observe the analytic fallback while later values use the LUT.
    if (nativeGradeLayer || colorVibranceWhiteBalanceActive) {
      this.compatibilityRequired = true;
      void this.requestColorVibranceCompatibility().catch(() => {});
    }
    const current = this.runtimes.get(layer.id);
    if (
      current
      && current.colorLookupAssetId === colorLookupAssetId
      && current.gradeLookAssetId === gradeLookAssetId
      && current.photoshopAdjustmentKind === photoshopAdjustmentKind
      && current.colorVibranceOwner === colorVibranceOwner
    ) return current;
    if (current) {
      this.destroyRuntime(current);
      this.runtimes.delete(layer.id);
    }
    const dependencies = this.dependencies;
    if (!dependencies) {
      throw new Error('LightTable adjustment-layer resources are not initialized.');
    }
    const uniformBuffer = this.device.createBuffer({
      label: `LightTable adjustment layer uniforms: ${layer.name}`,
      size: ADJUSTMENT_UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    const curveTexture = this.device.createTexture({
      label: `LightTable adjustment layer curve LUT: ${layer.name}`,
      size: [CURVE_LUT_SIZE, 1],
      format: 'rgba32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
    const colorLookup = dependencies.resolveColorLookup(colorLookupAssetId);
    const gradeLook = dependencies.resolveColorLookup(gradeLookAssetId);
    const colorVibranceCompatibilityTexture = colorVibranceOwner
      && loadedPhotoshopColorVibranceCompatibility()
      ? this.device.createTexture({
        label: `LightTable Color and Vibrance compatibility: ${layer.name}`,
        size: [
          PHOTOSHOP_COLOR_VIBRANCE_COMPATIBILITY_SIZE,
          PHOTOSHOP_COLOR_VIBRANCE_COMPATIBILITY_SIZE,
          PHOTOSHOP_COLOR_VIBRANCE_COMPATIBILITY_SIZE
        ],
        dimension: '3d',
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
      })
      : null;
    const colorVibranceColorTexture = colorVibranceCompatibilityTexture
      ? this.device.createTexture({
        label: `LightTable Color and Vibrance coupled color: ${layer.name}`,
        size: [
          PHOTOSHOP_COLOR_VIBRANCE_COLOR_SIZE,
          PHOTOSHOP_COLOR_VIBRANCE_COLOR_SIZE,
          PHOTOSHOP_COLOR_VIBRANCE_COLOR_SIZE
        ],
        dimension: '3d',
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
      })
      : null;
    const createCreativeBindGroup = (source: GPUTexture, spatialInput: GPUTexture) =>
      this.device.createBindGroup({
        layout: dependencies.creativePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: source.createView() },
          { binding: 1, resource: spatialInput.createView() },
          { binding: 2, resource: dependencies.sampler },
          { binding: 3, resource: { buffer: uniformBuffer } },
          { binding: 4, resource: curveTexture.createView() },
          { binding: 5, resource: (colorLookup?.texture
            ?? dependencies.identityColorLookupTexture).createView() },
          { binding: 6, resource: (colorVibranceCompatibilityTexture
            ?? dependencies.identityColorLookupTexture).createView() },
          { binding: 7, resource: (colorVibranceColorTexture
            ?? dependencies.identityColorLookupTexture).createView() },
          { binding: 8, resource: dependencies.photoshopColorBalanceTransferTexture.createView() },
          { binding: 9, resource: (gradeLook?.texture
            ?? dependencies.identityColorLookupTexture).createView() }
        ]
      });
    const runtime = {
      uniformBuffer,
      curveTexture,
      creativeBindGroup: createCreativeBindGroup(
        dependencies.correctedTexture,
        dependencies.downsampleTexture
      ),
      createCreativeBindGroup,
      payloadWriter: new AdjustmentGpuPayloadWriter(this.device, {
        uniformBuffer,
        curveTexture,
        ...(colorVibranceCompatibilityTexture ? { colorVibranceCompatibilityTexture } : {}),
        ...(colorVibranceColorTexture ? { colorVibranceColorTexture } : {}),
        ...(colorVibranceOwner ? { colorVibranceOwner } : {})
      }),
      colorLookupAssetId,
      gradeLookAssetId,
      photoshopAdjustmentKind,
      colorVibranceOwner,
      colorVibranceCompatibilityTexture,
      colorVibranceColorTexture,
      colorLookupUniform: colorLookup ? {
        enabled: true,
        domainMin: colorLookup.domainMin,
        domainMax: colorLookup.domainMax
      } : null,
      gradeLookUniform: gradeLook ? {
        enabled: true,
        strength: adjustments.gradeLook.strength,
        domainMin: gradeLook.domainMin,
        domainMax: gradeLook.domainMax
      } : null
    };
    this.runtimes.set(layer.id, runtime);
    return runtime;
  }

  /** Makes exact-pixel consumers wait until lazy Color/Vibrance volumes can be realized. */
  async waitForAdjustmentAssets(): Promise<boolean> {
    if (!this.compatibilityRequired) return false;
    await this.requestColorVibranceCompatibility();
    this.invalidateColorVibranceRuntimes();
    return true;
  }

  syncDocument(document: ImageDocument) {
    const activeIds = collectAdjustmentLayerIds(document.layers);
    for (const [layerId, runtime] of this.runtimes) {
      if (activeIds.has(layerId)) continue;
      this.destroyRuntime(runtime);
      this.runtimes.delete(layerId);
    }
  }

  invalidateColorLookupAsset(assetId: string): void {
    for (const [layerId, runtime] of this.runtimes) {
      if (runtime.colorLookupAssetId !== assetId && runtime.gradeLookAssetId !== assetId) continue;
      this.destroyRuntime(runtime);
      this.runtimes.delete(layerId);
    }
  }

  estimatedBytes() {
    let bytes = 0;
    for (const runtime of this.runtimes.values()) {
      bytes += ADJUSTMENT_UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT
        + CURVE_LUT_SIZE * 4 * Float32Array.BYTES_PER_ELEMENT;
      if (runtime.colorVibranceCompatibilityTexture) {
        bytes += PHOTOSHOP_COLOR_VIBRANCE_COMPATIBILITY_SIZE ** 3 * 4;
      }
      if (runtime.colorVibranceColorTexture) {
        bytes += PHOTOSHOP_COLOR_VIBRANCE_COLOR_SIZE ** 3 * 4;
      }
    }
    return bytes;
  }

  reset() {
    for (const runtime of this.runtimes.values()) this.destroyRuntime(runtime);
    this.runtimes.clear();
    this.dependencies = null;
    this.compatibilityLoadPromise = null;
    this.compatibilityRequired = false;
  }

  private requestColorVibranceCompatibility(): Promise<void> {
    if (loadedPhotoshopColorVibranceCompatibility()) return Promise.resolve();
    if (this.compatibilityLoadPromise) return this.compatibilityLoadPromise;
    this.compatibilityLoadPromise = loadPhotoshopColorVibranceCompatibility().then(() => {
      this.invalidateColorVibranceRuntimes();
      this.dependencies?.requestRender();
    }).catch((error: unknown) => {
      this.dependencies?.reportError(
        'color-vibrance-compatibility',
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }).finally(() => {
      this.compatibilityLoadPromise = null;
    });
    return this.compatibilityLoadPromise;
  }

  private invalidateColorVibranceRuntimes() {
    for (const [layerId, runtime] of this.runtimes) {
      if (runtime.colorVibranceOwner !== 'grade'
        && runtime.photoshopAdjustmentKind !== 'color-vibrance') continue;
      this.destroyRuntime(runtime);
      this.runtimes.delete(layerId);
    }
  }

  private destroyRuntime(runtime: AdjustmentLayerGpuRuntime) {
    runtime.uniformBuffer.destroy();
    runtime.curveTexture.destroy();
    runtime.colorVibranceCompatibilityTexture?.destroy();
    runtime.colorVibranceColorTexture?.destroy();
  }
}
