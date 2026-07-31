import { layerIsLocked, type LayerId, type RasterLayer } from '../document/documentTypes';
import type { ReversiblePixelEdit } from '../history/ReversiblePixelEdit';
import { invertMatrix } from '../tools/transform/affine';
import type { AffineMatrix } from '../tools/transform/transformTypes';
import { identityAffineMatrix } from './renderContract';
import type { LayerRuntimeStore } from './LayerRuntimeStore';
import type { SelectionTextureStore } from './SelectionTextureStore';
import type { ToolPipelineBundle } from './ToolPipelineBundle';
import type { TransformSessionStore } from './TransformSessionStore';

interface TransformRasterizerOptions {
  device: GPUDevice;
  sampler: GPUSampler;
  layerResources: LayerRuntimeStore;
  selectionTextures: SelectionTextureStore;
  sessions: TransformSessionStore;
  dimensions: () => { width: number; height: number };
  pipelines: () => ToolPipelineBundle;
  ensureSelectionTargets: () => void;
  createTexture: (label: string) => GPUTexture;
  createSelectionTexture: (label: string) => GPUTexture;
  invalidateLayer: (layerId: LayerId) => void;
  drawFullscreen: (
    encoder: GPUCommandEncoder,
    pipeline: GPURenderPipeline,
    bindGroup: GPUBindGroup,
    target: GPUTextureView,
    clearValue: GPUColor
  ) => void;
}

/**
 * Owns selection-aware transform rasterization and its GPU history snapshots.
 *
 * Complete-layer transforms remain document geometry and only use this service
 * for preview state. Selected-pixel transforms commit raster pixels and the
 * selection channel together as one reversible history entry.
 */
export class TransformRasterizer {
  constructor(private readonly options: TransformRasterizerOptions) {}

  begin(layer: RasterLayer, useSelection: boolean) {
    if (useSelection) this.options.ensureSelectionTargets();
    if (this.options.sessions.current) {
      throw new Error('Finish or cancel the active transform first.');
    }
    if (layerIsLocked(layer, 'position') || !layer.visible) {
      throw new Error('Select a visible, unlocked raster layer before transforming.');
    }
    const runtime = this.options.layerResources.raster(layer.id);
    if (!runtime) {
      throw new Error('The active raster layer is not available on the GPU.');
    }
    const { selectionTextures } = this.options;
    if (useSelection && (!selectionTextures.active || !selectionTextures.mask)) {
      throw new Error('The active selection is not available on the GPU.');
    }
    const { width, height } = this.options.dimensions();
    const sourceTexture = this.options.createTexture('LightTable transform source snapshot');
    const selectionTexture = useSelection
      ? this.options.createSelectionTexture('LightTable transform selection snapshot')
      : null;
    const previewTexture = this.options.createTexture('LightTable transform preview');
    const selectionPreview = useSelection
      ? this.options.createSelectionTexture('LightTable transformed selection preview')
      : null;
    const settingsBuffer = this.options.device.createBuffer({
      label: 'LightTable transform settings',
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    const encoder = this.options.device.createCommandEncoder({
      label: 'LightTable begin transform'
    });
    encoder.copyTextureToTexture(
      { texture: runtime.texture },
      { texture: sourceTexture },
      [width, height]
    );
    if (selectionTexture && selectionTextures.mask) {
      encoder.copyTextureToTexture(
        { texture: selectionTextures.mask },
        { texture: selectionTexture },
        [width, height]
      );
    }
    this.options.device.queue.submit([encoder.finish()]);
    this.options.sessions.begin({
      layerId: layer.id,
      matrix: identityAffineMatrix(),
      sourceTexture,
      selectionTexture,
      previewTexture,
      selectionPreview,
      settingsBuffer,
      usesSelection: useSelection
    });
  }

  update(matrix: AffineMatrix) {
    const session = this.options.sessions.current;
    if (!session) return false;
    const inverse = invertMatrix(matrix);
    if (!inverse) return false;
    session.matrix = matrix;
    // Whole-layer transforms are compositor geometry overrides. No pixels are
    // resampled until an explicit rasterize/merge operation.
    if (!session.usesSelection) return true;

    const { width, height } = this.options.dimensions();
    const { device, sampler, selectionTextures } = this.options;
    device.queue.writeBuffer(session.settingsBuffer, 0, new Float32Array([
      inverse.a, inverse.c, inverse.tx, 0,
      inverse.b, inverse.d, inverse.ty, 0,
      width, height, 1, 0
    ]));
    const selectionSource = session.selectionTexture ?? selectionTextures.mask;
    if (!selectionSource) return false;
    const pipelines = this.options.pipelines();
    const transformBindGroup = device.createBindGroup({
      layout: pipelines.transform.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: session.sourceTexture.createView() },
        { binding: 1, resource: selectionSource.createView() },
        { binding: 2, resource: sampler },
        { binding: 3, resource: { buffer: session.settingsBuffer } }
      ]
    });
    const encoder = device.createCommandEncoder({
      label: 'LightTable update transform preview'
    });
    this.options.drawFullscreen(
      encoder,
      pipelines.transform,
      transformBindGroup,
      session.previewTexture.createView(),
      { r: 0, g: 0, b: 0, a: 0 }
    );
    if (session.selectionTexture && session.selectionPreview) {
      const selectionBindGroup = device.createBindGroup({
        layout: pipelines.selectionTransform.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: session.selectionTexture.createView() },
          { binding: 1, resource: sampler },
          { binding: 2, resource: { buffer: session.settingsBuffer } }
        ]
      });
      this.options.drawFullscreen(
        encoder,
        pipelines.selectionTransform,
        selectionBindGroup,
        session.selectionPreview.createView(),
        { r: 0, g: 0, b: 0, a: 1 }
      );
    }
    device.queue.submit([encoder.finish()]);
    return true;
  }

  commit(): ReversiblePixelEdit | null {
    const session = this.options.sessions.current;
    if (!session) return null;
    const runtime = this.options.layerResources.raster(session.layerId);
    if (!runtime) {
      this.cancel();
      return null;
    }
    const { width, height } = this.options.dimensions();
    const { device, selectionTextures } = this.options;
    const encoder = device.createCommandEncoder({ label: 'LightTable commit transform' });
    encoder.copyTextureToTexture(
      { texture: session.previewTexture },
      { texture: runtime.texture },
      [width, height]
    );
    if (
      session.selectionPreview
      && selectionTextures.mask
      && selectionTextures.result
    ) {
      encoder.copyTextureToTexture(
        { texture: session.selectionPreview },
        { texture: selectionTextures.mask },
        [width, height]
      );
      encoder.copyTextureToTexture(
        { texture: session.selectionPreview },
        { texture: selectionTextures.result },
        [width, height]
      );
      selectionTextures.active = true;
    }
    device.queue.submit([encoder.finish()]);
    const historySeed = this.options.sessions.complete();
    if (!historySeed) return null;

    let undoPixels: GPUTexture | null = historySeed.sourceTexture;
    let undoSelection: GPUTexture | null = historySeed.selectionTexture;
    let redoPixels: GPUTexture | null = null;
    let redoSelection: GPUTexture | null = null;
    let applied = true;
    const { usesSelection, layerId } = historySeed;
    const swap = (direction: 'undo' | 'redo') => {
      const sourcePixels = direction === 'undo' ? undoPixels : redoPixels;
      const sourceSelection = direction === 'undo' ? undoSelection : redoSelection;
      if (!sourcePixels || applied !== (direction === 'undo')) return false;
      const targetRuntime = this.options.layerResources.raster(layerId);
      if (!targetRuntime) return false;
      const inversePixels = this.options.createTexture(
        `LightTable ${direction} transform history`
      );
      const inverseSelection = usesSelection
        ? this.options.createSelectionTexture(
            `LightTable ${direction} selection transform history`
          )
        : null;
      const historyEncoder = device.createCommandEncoder({
        label: `LightTable ${direction} transform`
      });
      historyEncoder.copyTextureToTexture(
        { texture: targetRuntime.texture },
        { texture: inversePixels },
        [width, height]
      );
      historyEncoder.copyTextureToTexture(
        { texture: sourcePixels },
        { texture: targetRuntime.texture },
        [width, height]
      );
      if (
        usesSelection
        && sourceSelection
        && inverseSelection
        && selectionTextures.mask
        && selectionTextures.result
      ) {
        historyEncoder.copyTextureToTexture(
          { texture: selectionTextures.mask },
          { texture: inverseSelection },
          [width, height]
        );
        historyEncoder.copyTextureToTexture(
          { texture: sourceSelection },
          { texture: selectionTextures.mask },
          [width, height]
        );
        historyEncoder.copyTextureToTexture(
          { texture: sourceSelection },
          { texture: selectionTextures.result },
          [width, height]
        );
      }
      device.queue.submit([historyEncoder.finish()]);
      sourcePixels.destroy();
      sourceSelection?.destroy();
      if (direction === 'undo') {
        undoPixels = null;
        undoSelection = null;
        redoPixels = inversePixels;
        redoSelection = inverseSelection;
        applied = false;
      } else {
        redoPixels = null;
        redoSelection = null;
        undoPixels = inversePixels;
        undoSelection = inverseSelection;
        applied = true;
      }
      this.options.invalidateLayer(layerId);
      return true;
    };
    return {
      byteSize: width * height * 8 * (usesSelection ? 2 : 1),
      undo: () => swap('undo'),
      redo: () => swap('redo'),
      destroy: () => {
        undoPixels?.destroy();
        undoSelection?.destroy();
        redoPixels?.destroy();
        redoSelection?.destroy();
        undoPixels = null;
        undoSelection = null;
        redoPixels = null;
        redoSelection = null;
      }
    };
  }

  cancel() {
    return this.options.sessions.cancel();
  }
}
