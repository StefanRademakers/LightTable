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
import type { ColorLookupUniform } from './adjustmentUniform';
import { PHOTOSHOP_COLOR_VIBRANCE_LUT_SIZE } from './photoshopColorVibranceLut';

export interface AdjustmentLayerGpuRuntime {
  uniformBuffer: GPUBuffer;
  curveTexture: GPUTexture;
  creativeBindGroup: GPUBindGroup;
  payloadWriter: AdjustmentGpuPayloadWriter;
  colorLookupAssetId: string | null;
  colorLookupUniform: ColorLookupUniform | null;
  photoshopAdjustmentKind: string;
  colorVibranceWhiteBalanceTexture: GPUTexture | null;
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
    const photoshopAdjustmentKind = photoshopAdjustment.kind;
    const current = this.runtimes.get(layer.id);
    if (
      current
      && current.colorLookupAssetId === colorLookupAssetId
      && current.photoshopAdjustmentKind === photoshopAdjustmentKind
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
    const createColorVibranceTexture = (label: string, format: GPUTextureFormat) => this.device.createTexture({
      label,
      size: [
        PHOTOSHOP_COLOR_VIBRANCE_LUT_SIZE,
        PHOTOSHOP_COLOR_VIBRANCE_LUT_SIZE,
        PHOTOSHOP_COLOR_VIBRANCE_LUT_SIZE
      ],
      dimension: '3d',
      format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
    const colorVibranceWhiteBalanceTexture = photoshopAdjustmentKind === 'color-vibrance'
      ? createColorVibranceTexture(
        `LightTable Color and Vibrance white balance: ${layer.name}`,
        'rgba32float'
      )
      : null;
    const colorVibranceColorTexture = photoshopAdjustmentKind === 'color-vibrance'
      ? createColorVibranceTexture(`LightTable Color and Vibrance color: ${layer.name}`, 'rgba8unorm')
      : null;
    const runtime = {
      uniformBuffer,
      curveTexture,
      creativeBindGroup: this.device.createBindGroup({
        layout: dependencies.creativePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: dependencies.correctedTexture.createView() },
          { binding: 1, resource: dependencies.downsampleTexture.createView() },
          { binding: 2, resource: dependencies.sampler },
          { binding: 3, resource: { buffer: uniformBuffer } },
          { binding: 4, resource: curveTexture.createView() },
          { binding: 5, resource: (colorLookup?.texture
            ?? dependencies.identityColorLookupTexture).createView() },
          { binding: 6, resource: (colorVibranceWhiteBalanceTexture
            ?? dependencies.identityColorLookupTexture).createView() },
          { binding: 7, resource: (colorVibranceColorTexture
            ?? dependencies.identityColorLookupTexture).createView() },
          { binding: 8, resource: dependencies.photoshopColorBalanceTransferTexture.createView() }
        ]
      }),
      payloadWriter: new AdjustmentGpuPayloadWriter(this.device, {
        uniformBuffer,
        curveTexture,
        ...(colorVibranceWhiteBalanceTexture ? { colorVibranceWhiteBalanceTexture } : {}),
        ...(colorVibranceColorTexture ? { colorVibranceColorTexture } : {})
      }),
      colorLookupAssetId,
      photoshopAdjustmentKind,
      colorVibranceWhiteBalanceTexture,
      colorVibranceColorTexture,
      colorLookupUniform: colorLookup ? {
        enabled: true,
        domainMin: colorLookup.domainMin,
        domainMax: colorLookup.domainMax
      } : null
    };
    this.runtimes.set(layer.id, runtime);
    return runtime;
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
      if (runtime.colorLookupAssetId !== assetId) continue;
      this.destroyRuntime(runtime);
      this.runtimes.delete(layerId);
    }
  }

  estimatedBytes() {
    let bytes = 0;
    for (const runtime of this.runtimes.values()) {
      bytes += ADJUSTMENT_UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT
        + CURVE_LUT_SIZE * 4 * Float32Array.BYTES_PER_ELEMENT;
      if (runtime.colorVibranceWhiteBalanceTexture) {
        bytes += PHOTOSHOP_COLOR_VIBRANCE_LUT_SIZE ** 3 * 4 * 2;
      }
    }
    return bytes;
  }

  reset() {
    for (const runtime of this.runtimes.values()) this.destroyRuntime(runtime);
    this.runtimes.clear();
    this.dependencies = null;
  }

  private destroyRuntime(runtime: AdjustmentLayerGpuRuntime) {
    runtime.uniformBuffer.destroy();
    runtime.curveTexture.destroy();
    runtime.colorVibranceWhiteBalanceTexture?.destroy();
    runtime.colorVibranceColorTexture?.destroy();
  }
}
