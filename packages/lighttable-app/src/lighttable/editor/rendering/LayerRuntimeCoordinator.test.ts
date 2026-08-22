import { describe, expect, it, vi } from 'vitest';
import type {
  ImageDocument,
  LayerId,
  RasterLayer
} from '../document/documentTypes';
import { createDefaultLayerStyleStack } from '../styles/layerStyleDefaults';
import { identityAffineMatrix } from './renderContract';
import { LayerRuntimeCoordinator } from './LayerRuntimeCoordinator';

const layerId = (value: string) => value as LayerId;

const rasterLayer = (value: string): RasterLayer => ({
  id: layerId(value),
  name: value,
  type: 'raster',
  visible: true,
  opacity: 1,
  fillOpacity: 1,
  blendMode: 'normal',
  clipping: false,
  styleStack: createDefaultLayerStyleStack(),
  locks: {
    transparency: false,
    pixels: false,
    position: false,
    all: false
  },
  transform: identityAffineMatrix(),
  revision: 0,
  geometryRevision: 0,
  createdAt: 0,
  modifiedAt: 0,
  pixelRevision: 0,
  width: 64,
  height: 32,
  offsetX: 0,
  offsetY: 0,
  pixelSource: { kind: 'runtime-raster', runtimeId: value },
  dirtyBounds: null,
  mask: null,
  adjustmentStack: null
});

describe('LayerRuntimeCoordinator', () => {
  it('synchronizes documents and invalidates only explicitly pruned runtimes', () => {
    const texture = {} as GPUTexture;
    const store = {
      sync: vi.fn(),
      pruneDetached: vi.fn(() => [layerId('removed')]),
      pruneDetachedFor: vi.fn(() => [layerId('removed-from-document')]),
      raster: vi.fn(() => ({ texture }))
    };
    const invalidateLayer = vi.fn();
    const coordinator = new LayerRuntimeCoordinator({
      store: store as never,
      invalidateLayer
    });
    const layer = rasterLayer('kept');
    const document = { layers: [layer] } as ImageDocument;

    coordinator.sync(document);
    expect(coordinator.pruneDetached(new Set([layerId('kept')]))).toEqual([
      layerId('removed')
    ]);
    expect(store.sync).toHaveBeenCalledWith(document.layers);
    expect(invalidateLayer).toHaveBeenCalledWith('removed');
    expect(coordinator.pruneDetachedFor('document-a', new Set())).toEqual([
      layerId('removed-from-document')
    ]);
    expect(store.pruneDetachedFor).toHaveBeenCalledWith(
      'document-a',
      new Set(),
      new Set()
    );
    expect(invalidateLayer).toHaveBeenCalledWith('removed-from-document');
    expect(coordinator.resolveRenderContract(layer)?.texture).toBe(texture);
  });

  it('returns no render contract when a raster runtime is unavailable', () => {
    const coordinator = new LayerRuntimeCoordinator({
      store: {
        sync: vi.fn(),
        pruneDetached: vi.fn(() => []),
        raster: vi.fn(() => null)
      } as never,
      invalidateLayer: vi.fn()
    });

    expect(coordinator.resolveRenderContract(rasterLayer('missing'))).toBeNull();
  });
});
