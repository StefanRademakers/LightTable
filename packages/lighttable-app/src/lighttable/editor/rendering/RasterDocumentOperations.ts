import type {
  AdjustmentLayer,
  ImageDocument,
  LayerId,
  LayerNode,
  RasterLayer,
  TextLayer,
  VectorLayer
} from '../document/documentTypes';
import { findLayerNode } from '../document/layerTree';
import type { LayerRuntimeStore } from './LayerRuntimeStore';
import { createDefaultLayerStyleStack } from '../styles/layerStyleDefaults';

export type EncodeAdjustment = (
  encoder: GPUCommandEncoder,
  source: GPUTexture,
  layer: AdjustmentLayer | RasterLayer
) => GPUTexture;

const findContributingTextLayers = (
  nodes: readonly LayerNode[],
  inheritedVisible = true
): TextLayer[] => nodes.flatMap((node) => {
  const visible = inheritedVisible && node.visible && node.opacity > 0;
  if (node.type === 'group') return findContributingTextLayers(node.children, visible);
  return node.type === 'text' && visible ? [node] : [];
});

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
  textSourceReady?: (layer: TextLayer) => boolean;
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
    if (source.width !== destination.width || source.height !== destination.height) return false;
    const { width, height } = source;
    const documentDimensions = this.options.dimensions();
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
        [documentDimensions.width, documentDimensions.height]
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
    if (this.options.textSourceReady && !this.options.textSourceReady(source)) return false;
    const runtime = this.options.layerResources.raster(destination.id);
    if (!runtime) return false;
    const { device } = this.options;
    const { width, height } = this.options.dimensions();
    if (destination.width !== width || destination.height !== height) return false;
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
      || layers.some(
        (layer) => layer?.type === 'text' && layer.visible && layer.opacity > 0
          && this.options.textSourceReady
          && !this.options.textSourceReady(layer)
      )
    ) return false;
    const { width, height } = this.options.dimensions();
    if (destination.width !== width || destination.height !== height) return false;
    const encoder = device.createCommandEncoder({
      label: 'LightTable merge selected layers'
    });
    const mergedTexture = this.options.encodeComposite(
      encoder,
      {
        ...document,
        layers: layers as Array<RasterLayer | AdjustmentLayer | TextLayer | VectorLayer>
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
    if (this.options.textSourceReady && findContributingTextLayers(group.children).some(
      (layer) => !this.options.textSourceReady!(layer)
    )) return false;
    const { width, height } = this.options.dimensions();
    if (destination.width !== width || destination.height !== height) return false;
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
    if (this.options.textSourceReady && findContributingTextLayers(document.layers).some(
      (layer) => !this.options.textSourceReady!(layer)
    )) return false;
    const { width, height } = this.options.dimensions();
    if (destination.width !== width || destination.height !== height) return false;
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
