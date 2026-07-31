import { describe, expect, it, vi } from 'vitest';
import type { LayerId } from '../document/documentTypes';
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
      maskTexture: texture('source mask'),
      maskId: 'mask-source'
    };
    const destination = {
      texture: texture('destination'),
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
      [1920, 1080]
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
});
