import type { ImageDocument, LayerId } from '../document/documentTypes';
import { walkRasterLayers } from '../document/layerTree';

export interface ImportedLayerInitializerOptions {
  device: GPUDevice;
  sampler: GPUSampler;
  decodePipeline: GPURenderPipeline;
  rasterTexture: (layerId: LayerId) => GPUTexture | null;
  drawFullscreen: (
    encoder: GPUCommandEncoder,
    pipeline: GPURenderPipeline,
    bindGroup: GPUBindGroup,
    target: GPUTextureView,
    clearValue: GPUColor
  ) => void;
}

/**
 * Hydrates the sole imported-image source used by a newly opened flat
 * document. Persisted layered documents intentionally skip this path because
 * their pixels are restored atomically by LayerDocumentAssetService.
 */
export class ImportedLayerInitializer {
  constructor(private readonly options: ImportedLayerInitializerOptions) {}

  initialize(document: ImageDocument, sourceTexture: GPUTexture) {
    const imported = walkRasterLayers(document.layers)
      .map(({ layer }) => layer)
      .find((layer) => layer.pixelSource.kind === 'imported-image');
    if (!imported) return false;

    const destination = this.options.rasterTexture(imported.id);
    if (!destination) {
      throw new Error('The imported LightTable layer could not be initialized.');
    }
    const bindGroup = this.options.device.createBindGroup({
      layout: this.options.decodePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: sourceTexture.createView() },
        { binding: 1, resource: this.options.sampler }
      ]
    });
    const encoder = this.options.device.createCommandEncoder({
      label: 'LightTable initialize layer document'
    });
    this.options.drawFullscreen(
      encoder,
      this.options.decodePipeline,
      bindGroup,
      destination.createView(),
      { r: 0, g: 0, b: 0, a: 0 }
    );
    this.options.device.queue.submit([encoder.finish()]);
    return true;
  }
}
