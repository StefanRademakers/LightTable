import { describe, expect, it, vi } from 'vitest';
import type {
  DocumentAssetId,
  LayerId,
  RasterLayer
} from '../document/documentTypes';
import { createImageDocument } from '../document/documentTypes';
import type { DocumentAssetBlob } from '../persistence/layeredDocumentFormat';
import { LayerDocumentAssetService, type LayerDocumentAssetPorts } from './LayerDocumentAssetService';

const patternId = 'pattern-1' as DocumentAssetId;
const texture = { label: 'pixels' } as GPUTexture;
const maskTexture = { label: 'mask' } as GPUTexture;
const pixels = new Blob(['pixels']);
const mask = new Blob(['mask']);
const pattern = new Blob(['pattern']);

const documentWith = () => {
  const document = createImageDocument('Assets', 64, 32, 'source');
  document.assets.patterns = [{
    id: patternId,
    name: 'Dots',
    width: 8,
    height: 8,
    revision: 0
  }];
  return document;
};

const createPorts = (): LayerDocumentAssetPorts => ({
  rasterTexture: vi.fn(() => texture),
  maskTexture: vi.fn(() => maskTexture),
  encodeTexture: vi.fn(async (_texture, maskChannel) => maskChannel ? mask : pixels),
  decodeTexture: vi.fn(async () => undefined),
  invalidateLayer: vi.fn(),
  patternSource: vi.fn(() => pattern),
  loadPattern: vi.fn(async () => undefined)
});

describe('LayerDocumentAssetService', () => {
  it('exports raster pixels, optional masks and immutable patterns', async () => {
    const ports = createPorts();
    const service = new LayerDocumentAssetService(ports);
    const document = documentWith();
    const layer = document.layers[0] as RasterLayer;
    const layerId = layer.id;
    layer.mask = {
      id: 'mask-1',
      enabled: true,
      density: 1,
      feather: 0,
      revision: 0,
      pixelRevision: 0,
      dirtyBounds: null
    };

    const assets = await service.export(document);

    expect(assets).toEqual([
      { layerId, pixels, mask },
      { patternId, source: pattern }
    ]);
    expect(ports.encodeTexture).toHaveBeenNthCalledWith(1, texture, false);
    expect(ports.encodeTexture).toHaveBeenNthCalledWith(2, maskTexture, true);
  });

  it('routes persisted assets to their canonical GPU destinations', async () => {
    const ports = createPorts();
    const service = new LayerDocumentAssetService(ports);
    const layerId = 'layer-1' as LayerId;
    const assets: DocumentAssetBlob[] = [
      { layerId, pixels, mask },
      { patternId, source: pattern },
      { sourceId: 'source-1' as DocumentAssetId, source: new Blob(['preserved']) }
    ];

    await service.load(assets);

    expect(ports.invalidateLayer).toHaveBeenCalledOnce();
    expect(ports.decodeTexture).toHaveBeenNthCalledWith(1, pixels, texture, false);
    expect(ports.decodeTexture).toHaveBeenNthCalledWith(2, mask, maskTexture, true);
    expect(ports.loadPattern).toHaveBeenCalledWith({ patternId, source: pattern });
  });

  it('fails before silently dropping unavailable raster pixels', async () => {
    const ports = createPorts();
    ports.rasterTexture = vi.fn(() => null);
    const service = new LayerDocumentAssetService(ports);
    const layerId = 'layer-1' as LayerId;

    await expect(service.load([{ layerId, pixels, mask: null }]))
      .rejects.toThrow(`Layer ${layerId} is not available while opening the document.`);
  });
});
