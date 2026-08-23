import type { LayerId, LayerNode, RasterLayer } from '../document/documentTypes';
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
  maskTexture: (layerId: LayerId) => GPUTexture | null;
  createCoverageTexture: (label: string, width: number, height: number) => GPUTexture;
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

  async measureSelection(): Promise<SelectionCoverageBounds | null> {
    const { device, textures, ensureTargets } = this.options;
    ensureTargets();
    if (!textures.active || !textures.mask) return null;
    const { width, height } = this.options.dimensions();
    const generation = this.options.generation();
    const bytesPerRow = Math.ceil(width / 256) * 256;
    const readBuffer = device.createBuffer({
      label: 'LightTable selection bounds readback',
      size: bytesPerRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });

    try {
      const encoder = device.createCommandEncoder({ label: 'LightTable measure selection bounds' });
      encoder.copyTextureToBuffer(
        { texture: textures.mask },
        { buffer: readBuffer, bytesPerRow, rowsPerImage: height },
        [width, height]
      );
      device.queue.submit([encoder.finish()]);
      await readBuffer.mapAsync(GPUMapMode.READ);
      if (generation !== this.options.generation()) return null;
      return selectionCoverageBounds(
        new Uint8Array(readBuffer.getMappedRange()),
        width,
        height,
        bytesPerRow
      );
    } finally {
      if (readBuffer.mapState === 'mapped') readBuffer.unmap();
      readBuffer.destroy();
    }
  }

  async measureMask(layer: LayerNode): Promise<SelectionCoverageBounds | null> {
    const { device, ensureTargets, maskTexture } = this.options;
    ensureTargets();
    const source = maskTexture(layer.id);
    if (!source) return null;
    const { width, height } = this.options.dimensions();
    const generation = this.options.generation();
    const bytesPerRow = Math.ceil(width / 256) * 256;
    const readBuffer = device.createBuffer({
      label: 'LightTable layer mask bounds readback',
      size: bytesPerRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });

    try {
      const encoder = device.createCommandEncoder({
        label: 'LightTable measure layer mask content'
      });
      encoder.copyTextureToBuffer(
        { texture: source },
        { buffer: readBuffer, bytesPerRow, rowsPerImage: height },
        [width, height]
      );
      device.queue.submit([encoder.finish()]);
      await readBuffer.mapAsync(GPUMapMode.READ);
      if (generation !== this.options.generation()) return null;
      return selectionCoverageBounds(
        new Uint8Array(readBuffer.getMappedRange()),
        width,
        height,
        bytesPerRow
      );
    } finally {
      if (readBuffer.mapState === 'mapped') readBuffer.unmap();
      readBuffer.destroy();
    }
  }

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

    // Coverage is layer-local. Tight raster runtimes must never be expanded to
    // the document surface here: the old full-canvas target clamped every
    // fragment beyond the source edge to the final source texel, which could
    // turn one opaque edge pixel into a document-sized transform cage.
    const width = runtime.width;
    const height = runtime.height;
    const generation = this.options.generation();
    const coverageTexture = createCoverageTexture(
      selectionEnabled
        ? 'LightTable selected content coverage'
        : 'LightTable layer content coverage',
      width,
      height
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
