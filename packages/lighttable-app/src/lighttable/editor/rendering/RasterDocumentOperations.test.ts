import { describe, expect, it, vi } from 'vitest';
import { createDefaultTextLayerData } from '@lighttable/text-core';
import { createTextLayer, rasterizeTextLayer } from '../document/documentCommands';
import { createImageDocument, createVectorLayer, type LayerId } from '../document/documentTypes';
import { findDocumentLayer, findRasterLayer } from '../document/layerTree';
import { RasterDocumentOperations } from './RasterDocumentOperations';

const texture = (name: string) => ({ name }) as unknown as GPUTexture;
const layerId = (value: string) => value as LayerId;

describe('RasterDocumentOperations', () => {
  it('duplicates raster and mask pixels and invalidates the destination cache', () => {
    const copyTextureToTexture = vi.fn();
    const submit = vi.fn();
    const invalidateLayer = vi.fn();
    const source = {
      texture: texture('source'),
      width: 320,
      height: 180,
      maskTexture: texture('source mask'),
      maskId: 'mask-source'
    };
    const destination = {
      texture: texture('destination'),
      width: 320,
      height: 180,
      maskTexture: texture('destination mask'),
      maskId: 'mask-destination'
    };
    const operations = new RasterDocumentOperations({
      device: {
        createCommandEncoder: () => ({
          copyTextureToTexture,
          finish: () => 'commands'
        }),
        queue: { submit }
      } as unknown as GPUDevice,
      layerResources: {
        raster: (id: string) => id === 'source' ? source : destination
      } as never,
      dimensions: () => ({ width: 1920, height: 1080 }),
      encodeComposite: vi.fn(),
      invalidateLayer,
      releaseSubmittedResources: vi.fn()
    });

    expect(operations.duplicate(layerId('source'), layerId('destination'))).toBe(true);
    expect(copyTextureToTexture).toHaveBeenCalledTimes(2);
    expect(copyTextureToTexture).toHaveBeenNthCalledWith(
      1,
      { texture: source.texture },
      { texture: destination.texture },
      [320, 180]
    );
    expect(submit).toHaveBeenCalledWith(['commands']);
    expect(invalidateLayer).toHaveBeenCalledWith('destination');
  });

  it('does not allocate commands for an invalid merge set', () => {
    const createCommandEncoder = vi.fn();
    const operations = new RasterDocumentOperations({
      device: { createCommandEncoder } as unknown as GPUDevice,
      layerResources: {
        raster: () => null
      } as never,
      dimensions: () => ({ width: 10, height: 10 }),
      encodeComposite: vi.fn(),
      invalidateLayer: vi.fn(),
      releaseSubmittedResources: vi.fn()
    });

    expect(operations.merge(
      { layers: [] } as never,
      [layerId('missing-a'), layerId('missing-b')],
      layerId('missing-a')
    )).toBe(false);
    expect(createCommandEncoder).not.toHaveBeenCalled();
  });

  it('composites a cached vector presentation into the raster destination', () => {
    const document = createImageDocument('Shape merge', 64, 32, 'background');
    const vector = createVectorLayer([], 'Shape');
    document.layers.push(vector);
    const destinationId = document.layers[0]!.id;
    const destinationTexture = texture('destination');
    const compositeTexture = texture('vector composite');
    const copyTextureToTexture = vi.fn();
    const submit = vi.fn();
    const encodeComposite = vi.fn(() => compositeTexture);
    const operations = new RasterDocumentOperations({
      device: {
        createCommandEncoder: () => ({ copyTextureToTexture, finish: () => 'commands' }),
        queue: { submit }
      } as unknown as GPUDevice,
      layerResources: {
        raster: (id: string) => id === destinationId
          ? {
              texture: destinationTexture,
              width: 64,
              height: 32,
              maskTexture: null,
              maskId: null
            } : null
      } as never,
      dimensions: () => ({ width: 64, height: 32 }),
      encodeComposite,
      invalidateLayer: vi.fn(),
      releaseSubmittedResources: vi.fn()
    });

    expect(operations.merge(document, [destinationId, vector.id], destinationId)).toBe(true);
    expect(encodeComposite).toHaveBeenCalledWith(expect.anything(), {
      ...document, layers: [document.layers[0], vector]
    }, undefined);
    expect(copyTextureToTexture).toHaveBeenCalledWith(
      { texture: compositeTexture }, { texture: destinationTexture }, [64, 32]
    );
    expect(submit).toHaveBeenCalledWith(['commands']);
  });

  it('renders isolated normalized text into its prepared same-ID raster destination', () => {
    const document = createTextLayer(
      createImageDocument('Text', 64, 32, 'background'),
      createDefaultTextLayerData(),
      'Headline'
    );
    const source = findDocumentLayer(document, document.activeLayerId);
    const destinationDocument = rasterizeTextLayer(document, document.activeLayerId!);
    const destination = findRasterLayer(destinationDocument, document.activeLayerId!);
    if (source?.type !== 'text' || !destination) throw new Error('Expected text rasterization fixtures.');
    const destinationTexture = texture('destination');
    const compositeTexture = texture('composite');
    const ensureRaster = vi.fn(() => ({
      texture: destinationTexture,
      maskTexture: null,
      maskId: null
    }));
    const copyTextureToTexture = vi.fn();
    const submit = vi.fn();
    const encodeComposite = vi.fn(() => compositeTexture);
    const releaseSubmittedResources = vi.fn();
    const invalidateLayer = vi.fn();
    const layerResources = {
      hasRaster: vi.fn(() => false),
      ensureRaster,
      raster: vi.fn(() => ({ texture: destinationTexture, maskTexture: null, maskId: null })),
      releaseRaster: vi.fn(() => true)
    };
    const operations = new RasterDocumentOperations({
      device: {
        createCommandEncoder: () => ({ copyTextureToTexture, finish: () => 'commands' }),
        queue: { submit }
      } as unknown as GPUDevice,
      layerResources: layerResources as never,
      dimensions: () => ({ width: 64, height: 32 }),
      encodeComposite,
      invalidateLayer,
      releaseSubmittedResources
    });

    expect(operations.prepareRasterDestination(destination)).toBe(true);
    expect(operations.rasterizeText(document, source, destination)).toBe(true);

    expect(ensureRaster).toHaveBeenCalledWith(destination);
    expect(encodeComposite).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        layers: [expect.objectContaining({
          id: source.id,
          type: 'text',
          opacity: 1,
          fillOpacity: 1,
          blendMode: 'normal',
          clipping: false,
          mask: null
        })]
      })
    );
    expect(copyTextureToTexture).toHaveBeenCalledWith(
      { texture: compositeTexture },
      { texture: destinationTexture },
      [64, 32]
    );
    expect(submit).toHaveBeenCalledWith(['commands']);
    expect(releaseSubmittedResources).toHaveBeenCalledOnce();
    expect(invalidateLayer).toHaveBeenCalledWith(destination.id);

    expect(operations.releaseRasterDestination(destination.id)).toBe(true);
    expect(layerResources.releaseRaster).toHaveBeenCalledWith(destination.id, true);
  });

  it('performs an exact zero-submit bypass while a text source is unready', () => {
    const document = createTextLayer(
      createImageDocument('Text', 64, 32, 'background'),
      createDefaultTextLayerData(),
      'Headline'
    );
    const source = findDocumentLayer(document, document.activeLayerId);
    const destination = findRasterLayer(
      rasterizeTextLayer(document, document.activeLayerId!),
      document.activeLayerId!
    );
    if (source?.type !== 'text' || !destination) throw new Error('Expected text fixtures.');
    const createCommandEncoder = vi.fn();
    const submit = vi.fn();
    const operations = new RasterDocumentOperations({
      device: { createCommandEncoder, queue: { submit } } as unknown as GPUDevice,
      layerResources: {
        raster: vi.fn(() => ({ texture: texture('destination'), maskTexture: null }))
      } as never,
      dimensions: () => ({ width: 64, height: 32 }),
      encodeComposite: vi.fn(),
      invalidateLayer: vi.fn(),
      releaseSubmittedResources: vi.fn(),
      textSourceReady: vi.fn(() => false)
    });

    expect(operations.rasterizeText(document, source, destination)).toBe(false);
    expect(createCommandEncoder).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });
});
