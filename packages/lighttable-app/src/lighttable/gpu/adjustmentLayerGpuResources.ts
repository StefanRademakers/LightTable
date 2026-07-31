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

export interface AdjustmentLayerGpuRuntime {
  uniformBuffer: GPUBuffer;
  curveTexture: GPUTexture;
  creativeBindGroup: GPUBindGroup;
  payloadWriter: AdjustmentGpuPayloadWriter;
}

export interface AdjustmentLayerGpuDependencies {
  sampler: GPUSampler;
  creativePipeline: GPURenderPipeline;
  correctedTexture: GPUTexture;
  downsampleTexture: GPUTexture;
}

export function collectAdjustmentLayerIds(nodes: readonly LayerNode[]): Set<LayerId> {
  const ids = new Set<LayerId>();
  const visit = (entries: readonly LayerNode[]) => {
    for (const node of entries) {
      if (
        node.type === 'adjustment'
        || (node.type === 'raster' && node.adjustmentStack)
      ) ids.add(node.id);
      else if (node.type === 'group') visit(node.children);
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
    const current = this.runtimes.get(layer.id);
    if (current) return current;
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
          { binding: 4, resource: curveTexture.createView() }
        ]
      }),
      payloadWriter: new AdjustmentGpuPayloadWriter(this.device, {
        uniformBuffer,
        curveTexture
      })
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

  estimatedBytes() {
    return this.runtimes.size * (
      ADJUSTMENT_UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT
      + CURVE_LUT_SIZE * 4 * Float32Array.BYTES_PER_ELEMENT
    );
  }

  reset() {
    for (const runtime of this.runtimes.values()) this.destroyRuntime(runtime);
    this.runtimes.clear();
    this.dependencies = null;
  }

  private destroyRuntime(runtime: AdjustmentLayerGpuRuntime) {
    runtime.uniformBuffer.destroy();
    runtime.curveTexture.destroy();
  }
}
