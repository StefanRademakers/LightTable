import type { RasterLayer } from '../document/documentTypes';
import {
  selectionCoverageBounds,
  type SelectionCoverageBounds
} from '../selection/selectionCoverage';
import type { RasterLayerRuntime } from './LayerRuntimeStore';
import type { SelectionTextureStore } from './SelectionTextureStore';
import type { ToolPipelineBundle } from './ToolPipelineBundle';

interface SelectionContentAnalyzerOptions {
  device: GPUDevice;
  textures: SelectionTextureStore;
  dimensions: () => { width: number; height: number };
  generation: () => number;
  pipelines: () => ToolPipelineBundle;
  ensureTargets: () => void;
  rasterRuntime: (layerId: RasterLayer['id']) => RasterLayerRuntime | null;
  createCoverageTexture: (label: string) => GPUTexture;
  drawFullscreen: (
    encoder: GPUCommandEncoder,
    pipeline: GPURenderPipeline,
    bindGroup: GPUBindGroup,
    target: GPUTextureView,
    clearValue: GPUColor
  ) => void;
}

/**
 * Measures visible raster content on the GPU and returns semantic bounds for
 * selection transforms. It owns the temporary coverage/readback resources so
 * the document renderer only coordinates document-level behavior.
 */
export class SelectionContentAnalyzer {
  constructor(private readonly options: SelectionContentAnalyzerOptions) {}

  async measure(
    layer: RasterLayer,
    selectionEnabled: boolean
  ): Promise<SelectionCoverageBounds | null> {
    const {
      device,
      textures,
      ensureTargets,
      rasterRuntime,
      createCoverageTexture,
      drawFullscreen
    } = this.options;
    ensureTargets();
    if (selectionEnabled && !textures.active) return null;
    if (!textures.mask) return null;
    const runtime = rasterRuntime(layer.id);
    if (!runtime) return null;

    const { width, height } = this.options.dimensions();
    const generation = this.options.generation();
    const coverageTexture = createCoverageTexture(
      selectionEnabled
        ? 'LightTable selected content coverage'
        : 'LightTable layer content coverage'
    );
    const bytesPerRow = Math.ceil(width / 256) * 256;
    const readBuffer = device.createBuffer({
      label: selectionEnabled
        ? 'LightTable selected content bounds readback'
        : 'LightTable layer content bounds readback',
      size: bytesPerRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    const settingsBuffer = device.createBuffer({
      label: selectionEnabled
        ? 'LightTable selected content settings'
        : 'LightTable layer content settings',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(settingsBuffer, 0, new Float32Array([
      layer.opacity,
      layer.mask?.enabled && runtime.maskTexture ? 1 : 0,
      selectionEnabled ? 1 : 0,
      0
    ]));
    const pipeline = this.options.pipelines().selectionContentCoverage;
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: runtime.texture.createView() },
        { binding: 1, resource: textures.mask.createView() },
        { binding: 2, resource: (runtime.maskTexture ?? runtime.texture).createView() },
        { binding: 3, resource: { buffer: settingsBuffer } }
      ]
    });

    try {
      const encoder = device.createCommandEncoder({
        label: selectionEnabled
          ? 'LightTable measure selected content'
          : 'LightTable measure layer content'
      });
      drawFullscreen(
        encoder,
        pipeline,
        bindGroup,
        coverageTexture.createView(),
        { r: 0, g: 0, b: 0, a: 1 }
      );
      encoder.copyTextureToBuffer(
        { texture: coverageTexture },
        { buffer: readBuffer, bytesPerRow, rowsPerImage: height },
        [width, height]
      );
      device.queue.submit([encoder.finish()]);
      await readBuffer.mapAsync(GPUMapMode.READ);
      if (generation !== this.options.generation()) return null;
      const bytes = new Uint8Array(readBuffer.getMappedRange());
      return selectionCoverageBounds(bytes, width, height, bytesPerRow);
    } finally {
      if (readBuffer.mapState === 'mapped') readBuffer.unmap();
      readBuffer.destroy();
      settingsBuffer.destroy();
      coverageTexture.destroy();
    }
  }
}
