import type {
  AdjustmentLayer,
  ImageDocument,
  LayerId,
  RasterLayer,
  TextLayer
} from '../document/documentTypes';
import { findLayerNode } from '../document/layerTree';
import type { LayerRuntimeStore } from './LayerRuntimeStore';
import { createDefaultLayerStyleStack } from '../styles/layerStyleDefaults';

export type EncodeAdjustment = (
  encoder: GPUCommandEncoder,
  source: GPUTexture,
  layer: AdjustmentLayer | RasterLayer
) => GPUTexture;

interface RasterDocumentOperationsOptions {
  device: GPUDevice;
  layerResources: LayerRuntimeStore;
  dimensions: () => { width: number; height: number };
  encodeComposite: (
    encoder: GPUCommandEncoder,
    document: ImageDocument,
    encodeAdjustment?: EncodeAdjustment
  ) => GPUTexture;
  invalidateLayer: (layerId: LayerId) => void;
  releaseSubmittedResources: () => void;
}

/**
 * Owns destructive document-level raster writes. Document commands decide
 * which nodes survive; this service performs the corresponding GPU copy,
 * merge and flatten operation without leaking compositor details upward.
 */
export class RasterDocumentOperations {
  private readonly newRasterReservations = new Set<LayerId>();

  constructor(private readonly options: RasterDocumentOperationsOptions) {}

  duplicate(sourceId: LayerId, destinationId: LayerId) {
    const { device, layerResources } = this.options;
    const source = layerResources.raster(sourceId);
    const destination = layerResources.raster(destinationId);
    if (!source || !destination) return false;
    const { width, height } = this.options.dimensions();
    const encoder = device.createCommandEncoder({
      label: 'LightTable duplicate raster layer'
    });
    encoder.copyTextureToTexture(
      { texture: source.texture },
      { texture: destination.texture },
      [width, height]
    );
    if (source.maskTexture && destination.maskTexture) {
      encoder.copyTextureToTexture(
        { texture: source.maskTexture },
        { texture: destination.maskTexture },
        [width, height]
      );
    }
    device.queue.submit([encoder.finish()]);
    this.options.invalidateLayer(destinationId);
    return true;
  }

  prepareRasterDestination(destination: RasterLayer) {
    if (!this.options.layerResources.hasRaster(destination.id)) {
      this.newRasterReservations.add(destination.id);
    }
    this.options.layerResources.ensureRaster(destination);
    return true;
  }

  commitRasterDestination(layerId: LayerId) {
    this.newRasterReservations.delete(layerId);
  }

  releaseRasterDestination(layerId: LayerId) {
    if (!this.newRasterReservations.delete(layerId)) return false;
    return this.options.layerResources.releaseRaster(layerId, true);
  }

  rasterizeText(
    document: ImageDocument,
    source: TextLayer,
    destination: RasterLayer
  ) {
    if (source.id !== destination.id) return false;
    const runtime = this.options.layerResources.raster(destination.id);
    if (!runtime) return false;
    const { device } = this.options;
    const { width, height } = this.options.dimensions();
    const encoder = device.createCommandEncoder({ label: 'LightTable rasterize text layer' });
    const renderedTexture = this.options.encodeComposite(encoder, {
      ...document,
      layers: [{
        ...source,
        visible: true,
        opacity: 1,
        fillOpacity: 1,
        blendMode: 'normal',
        clipping: false,
        styleStack: createDefaultLayerStyleStack(),
        mask: null
      }]
    });
    encoder.copyTextureToTexture(
      { texture: renderedTexture },
      { texture: runtime.texture },
      [width, height]
    );
    device.queue.submit([encoder.finish()]);
    this.options.releaseSubmittedResources();
    this.options.invalidateLayer(destination.id);
    return true;
  }

  merge(
    document: ImageDocument,
    layerIds: readonly LayerId[],
    destinationId: LayerId,
    encodeAdjustment?: EncodeAdjustment
  ) {
    const { device, layerResources } = this.options;
    const destination = layerResources.raster(destinationId);
    const layers = layerIds.map(
      (layerId) => findLayerNode(document.layers, layerId)?.node ?? null
    );
    if (
      !destination
      || layers.length < 2
      || layers.some((layer) => !layer)
      || layers.some((layer) => layer?.type === 'group')
      || layers.some(
        (layer) => layer?.type === 'raster' && !layerResources.raster(layer.id)
      )
    ) return false;
    const { width, height } = this.options.dimensions();
    const encoder = device.createCommandEncoder({
      label: 'LightTable merge selected layers'
    });
    const mergedTexture = this.options.encodeComposite(
      encoder,
      {
        ...document,
        layers: layers as Array<RasterLayer | AdjustmentLayer>
      },
      encodeAdjustment
    );
    encoder.copyTextureToTexture(
      { texture: mergedTexture },
      { texture: destination.texture },
      [width, height]
    );
    device.queue.submit([encoder.finish()]);
    this.options.releaseSubmittedResources();
    this.options.invalidateLayer(destinationId);
    return true;
  }

  flattenGroup(
    document: ImageDocument,
    groupId: LayerId,
    destinationId: LayerId,
    encodeAdjustment?: EncodeAdjustment
  ) {
    const { device, layerResources } = this.options;
    const group = findLayerNode(document.layers, groupId)?.node;
    const destination = layerResources.raster(destinationId);
    if (!group || group.type !== 'group' || !destination) return false;
    const { width, height } = this.options.dimensions();
    const encoder = device.createCommandEncoder({ label: 'LightTable flatten group' });
    const flattenedTexture = this.options.encodeComposite(
      encoder,
      {
        ...document,
        layers: [{ ...group, visible: true }]
      },
      encodeAdjustment
    );
    encoder.copyTextureToTexture(
      { texture: flattenedTexture },
      { texture: destination.texture },
      [width, height]
    );
    device.queue.submit([encoder.finish()]);
    this.options.releaseSubmittedResources();
    this.options.invalidateLayer(destinationId);
    return true;
  }

  flattenImage(
    document: ImageDocument,
    destinationId: LayerId,
    encodeAdjustment?: EncodeAdjustment
  ) {
    const { device, layerResources } = this.options;
    const destination = layerResources.raster(destinationId);
    if (!destination) return false;
    const { width, height } = this.options.dimensions();
    const encoder = device.createCommandEncoder({ label: 'LightTable flatten image' });
    const flattenedTexture = this.options.encodeComposite(
      encoder,
      document,
      encodeAdjustment
    );
    encoder.copyTextureToTexture(
      { texture: flattenedTexture },
      { texture: destination.texture },
      [width, height]
    );
    device.queue.submit([encoder.finish()]);
    this.options.releaseSubmittedResources();
    this.options.invalidateLayer(destinationId);
    return true;
  }
}
