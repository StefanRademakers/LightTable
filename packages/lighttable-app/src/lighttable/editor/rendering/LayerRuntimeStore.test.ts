import { describe, expect, it, vi } from 'vitest';
import {
  createGroupLayer,
  createImageDocument,
  type RasterLayer
} from '../document/documentTypes';
import { LayerRuntimeStore } from './LayerRuntimeStore';

const texture = () => ({ destroy: vi.fn() }) as unknown as GPUTexture;

describe('LayerRuntimeStore', () => {
  it('retains detached raster pixels until the explicit prune boundary', () => {
    const createdRaster: GPUTexture[] = [];
    const store = new LayerRuntimeStore({
      createRasterTexture: () => {
        const result = texture();
        createdRaster.push(result);
        return result;
      },
      createMaskTexture: texture
    });
    const document = createImageDocument('test', 64, 64, 'source');
    const layer = document.layers[0] as RasterLayer;

    store.sync(document.layers);
    store.sync([]);

    expect(store.raster(layer.id)?.texture).toBe(createdRaster[0]);
    expect(createdRaster[0].destroy).not.toHaveBeenCalled();

    expect(store.pruneDetached(new Set())).toEqual([layer.id]);
    expect(createdRaster[0].destroy).toHaveBeenCalledOnce();
  });

  it('owns raster and non-raster mask replacement lifecycles', () => {
    const masks: GPUTexture[] = [];
    const store = new LayerRuntimeStore({
      createRasterTexture: texture,
      createMaskTexture: () => {
        const result = texture();
        masks.push(result);
        return result;
      }
    });
    const document = createImageDocument('test', 64, 64, 'source');
    const raster = document.layers[0] as RasterLayer;
    raster.mask = {
      id: 'raster-mask-a',
      enabled: true,
      density: 1,
      feather: 0,
      revision: 0,
      pixelRevision: 0,
      dirtyBounds: null
    };
    const group = createGroupLayer('group');
    group.mask = { ...raster.mask, id: 'group-mask-a' };

    store.sync([raster, group]);
    const firstRasterMask = store.maskTexture(raster.id);
    const firstGroupMask = store.maskTexture(group.id);
    raster.mask = { ...raster.mask, id: 'raster-mask-b' };
    group.mask = { ...group.mask, id: 'group-mask-b' };
    store.sync([raster, group]);

    expect(firstRasterMask?.destroy).toHaveBeenCalledOnce();
    expect(firstGroupMask?.destroy).toHaveBeenCalledOnce();
    expect(store.maskTexture(raster.id)).not.toBe(firstRasterMask);
    expect(store.maskTexture(group.id)).not.toBe(firstGroupMask);

    raster.mask = null;
    group.mask = null;
    const secondRasterMask = store.maskTexture(raster.id);
    const secondGroupMask = store.maskTexture(group.id);
    store.sync([raster, group]);

    expect(secondRasterMask?.destroy).toHaveBeenCalledOnce();
    expect(secondGroupMask?.destroy).toHaveBeenCalledOnce();
    expect(store.maskTexture(raster.id)).toBeNull();
    expect(store.maskTexture(group.id)).toBeNull();
  });

  it('reports only textures it owns', () => {
    const store = new LayerRuntimeStore({
      createRasterTexture: texture,
      createMaskTexture: texture
    });
    const document = createImageDocument('test', 10, 5, 'source');
    const raster = document.layers[0] as RasterLayer;
    raster.mask = {
      id: 'mask',
      enabled: true,
      density: 1,
      feather: 0,
      revision: 0,
      pixelRevision: 0,
      dirtyBounds: null
    };
    store.sync(document.layers);

    expect(store.estimatedTextureBytes(10, 5)).toBe(10 * 5 * 8 * 2);
  });
});
