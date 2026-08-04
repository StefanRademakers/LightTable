import { describe, expect, it, vi } from 'vitest';
import { createDefaultTextLayerData } from '@lighttable/text-core';
import {
  createGroupLayer,
  createImageDocument,
  createVectorLayer,
  createTextLayerNode,
  semanticLayerDependencyKey,
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
    const vector = createVectorLayer([], 'shape');
    vector.mask = { ...raster.mask, id: 'vector-mask-a' };

    store.sync([raster, group, vector]);
    const firstRasterMask = store.maskTexture(raster.id);
    const firstGroupMask = store.maskTexture(group.id);
    const firstVectorMask = store.maskTexture(vector.id);
    raster.mask = { ...raster.mask, id: 'raster-mask-b' };
    group.mask = { ...group.mask, id: 'group-mask-b' };
    vector.mask = { ...vector.mask, id: 'vector-mask-b' };
    store.sync([raster, group, vector]);

    expect(firstRasterMask?.destroy).toHaveBeenCalledOnce();
    expect(firstGroupMask?.destroy).toHaveBeenCalledOnce();
    expect(firstVectorMask?.destroy).toHaveBeenCalledOnce();
    expect(store.maskTexture(raster.id)).not.toBe(firstRasterMask);
    expect(store.maskTexture(group.id)).not.toBe(firstGroupMask);
    expect(store.maskTexture(vector.id)).not.toBe(firstVectorMask);

    raster.mask = null;
    group.mask = null;
    vector.mask = null;
    const secondRasterMask = store.maskTexture(raster.id);
    const secondGroupMask = store.maskTexture(group.id);
    const secondVectorMask = store.maskTexture(vector.id);
    store.sync([raster, group, vector]);

    expect(secondRasterMask?.destroy).toHaveBeenCalledOnce();
    expect(secondGroupMask?.destroy).toHaveBeenCalledOnce();
    expect(secondVectorMask?.destroy).toHaveBeenCalledOnce();
    expect(store.maskTexture(raster.id)).toBeNull();
    expect(store.maskTexture(group.id)).toBeNull();
    expect(store.maskTexture(vector.id)).toBeNull();
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

    expect(store.estimatedTextureBytes(10, 5)).toBe(10 * 5 * (8 + 1));
  });

  it('allocates and estimates raster surfaces at layer-local dimensions', () => {
    const allocations: Array<{ width: number; height: number }> = [];
    const store = new LayerRuntimeStore({
      createRasterTexture: (_label, width, height) => {
        allocations.push({ width, height });
        return texture();
      },
      createMaskTexture: texture
    });
    const document = createImageDocument('test', 100, 80, 'source');
    const raster = document.layers[0] as RasterLayer;
    raster.width = 12;
    raster.height = 7;

    store.sync(document.layers);

    expect(allocations).toEqual([{ width: 12, height: 7 }]);
    expect(store.estimatedTextureBytes(100, 80)).toBe(12 * 7 * 8);
  });

  it('retains bounded semantic previews until the explicit history prune boundary', () => {
    const allocations: Array<{ width: number; height: number; texture: GPUTexture }> = [];
    const store = new LayerRuntimeStore({
      createRasterTexture: (_label, width, height) => {
        const result = texture();
        allocations.push({ width, height, texture: result });
        return result;
      },
      createMaskTexture: texture
    });
    const text = createTextLayerNode(createDefaultTextLayerData(), 'Cached text');
    text.derivedPreview = {
      width: 12,
      height: 7,
      transform: text.transform,
      dependencyKey: semanticLayerDependencyKey(text)!,
      source: 'photoshop-layer-preview'
    };

    store.sync([text]);
    store.sync([]);

    expect(allocations).toMatchObject([{ width: 12, height: 7 }]);
    expect(store.derivedPreview(text.id)?.texture).toBe(allocations[0].texture);
    expect(allocations[0].texture.destroy).not.toHaveBeenCalled();
    expect(store.estimatedTextureBytes(100, 80)).toBe(12 * 7 * 8);
    expect(store.pruneDetached(new Set(), new Set())).toEqual([text.id]);
    expect(allocations[0].texture.destroy).toHaveBeenCalledOnce();
  });

  it('promotes a text node mask into raster ownership without destroying or copying it', () => {
    const masks: GPUTexture[] = [];
    const store = new LayerRuntimeStore({
      createRasterTexture: texture,
      createMaskTexture: () => {
        const result = texture();
        masks.push(result);
        return result;
      }
    });
    const text = createTextLayerNode(createDefaultTextLayerData(), 'Text');
    text.mask = {
      id: 'text-mask',
      enabled: true,
      density: 1,
      feather: 0,
      revision: 0,
      pixelRevision: 0,
      dirtyBounds: null
    };
    store.sync([text]);
    const nodeMask = store.maskTexture(text.id);
    const raster = {
      ...text,
      type: 'raster' as const,
      width: 10,
      height: 5,
      offsetX: 0,
      offsetY: 0,
      pixelRevision: 1,
      pixelSource: { kind: 'runtime-raster' as const, runtimeId: text.id },
      adjustmentStack: null,
      dirtyBounds: null
    };
    delete (raster as Partial<typeof raster> & { text?: unknown }).text;

    const runtime = store.ensureRaster(raster as RasterLayer);
    expect(runtime.maskTexture).toBe(nodeMask);
    store.sync([text]);

    expect(runtime.maskTexture).toBeNull();
    expect(masks).toHaveLength(1);
    expect(nodeMask?.destroy).not.toHaveBeenCalled();
    expect(store.maskTexture(text.id)).toBe(nodeMask);

    store.sync([raster as RasterLayer]);
    expect(runtime.maskTexture).toBe(nodeMask);
    expect(masks).toHaveLength(1);
    expect(store.maskTexture(text.id)).toBe(nodeMask);

    store.sync([text]);
    expect(store.pruneDetached(new Set(), new Set([text.id]))).toEqual([text.id]);
    expect(runtime.texture.destroy).toHaveBeenCalledOnce();
    expect(nodeMask?.destroy).not.toHaveBeenCalled();
    expect(store.maskTexture(text.id)).toBe(nodeMask);
  });
});
