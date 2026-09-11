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
import { DocumentLayerResourceRepository } from './DocumentLayerResourceRepository';

const texture = () => ({ destroy: vi.fn() }) as unknown as GPUTexture;

describe('LayerRuntimeStore', () => {
  it('rejects a metadata-only resize before changing any resources', () => {
    const createRasterTexture = vi.fn(texture);
    const store = new LayerRuntimeStore({ createRasterTexture, createMaskTexture: texture });
    const document = createImageDocument('test', 64, 32, 'source');
    const raster = document.layers[0] as RasterLayer;
    store.sync([raster]);
    const pixels = store.raster(raster.id)!.texture;
    const fresh = { ...raster, id: 'new-layer' as RasterLayer['id'] };

    expect(() => store.sync([fresh, { ...raster, width: 128 }]))
      .toThrow(/pixel surface.*64x32.*128x32/i);
    expect(store.raster(raster.id)).toMatchObject({ texture: pixels, width: 64, height: 32 });
    expect(pixels.destroy).not.toHaveBeenCalled();
    expect(store.raster(fresh.id)).toBeNull();
    expect(createRasterTexture).toHaveBeenCalledTimes(1);
  });

  it('requires explicit pixel exchange for resize, undo and redo without reallocating', () => {
    const createRasterTexture = vi.fn(texture);
    const store = new LayerRuntimeStore({ createRasterTexture, createMaskTexture: texture });
    const document = createImageDocument('test', 64, 32, 'source');
    const before = document.layers[0] as RasterLayer;
    const after = { ...before, width: 128, height: 96 };
    store.sync([before]);
    const original = store.raster(before.id)!.texture;
    const edited = texture();
    let retained = store.exchangeRasterPixels(before.id, { texture: edited, width: 128, height: 96 });
    store.sync([after]);
    // A delayed pre-edit projection cannot replace the newly authored pixels.
    expect(() => store.sync([before])).toThrow(/pixel surface/i);
    expect(store.raster(before.id)!.texture).toBe(edited);
    retained = store.exchangeRasterPixels(before.id, retained);
    store.sync([before]);
    expect(store.raster(before.id)!.texture).toBe(original);
    retained = store.exchangeRasterPixels(before.id, retained);
    store.sync([after]);
    expect(store.raster(before.id)!.texture).toBe(edited);
    expect(retained.texture).toBe(original);
    expect(original.destroy).not.toHaveBeenCalled();
    expect(edited.destroy).not.toHaveBeenCalled();
    expect(createRasterTexture).toHaveBeenCalledTimes(1);
  });

  it('rejects a nested mismatch before removing an earlier layer mask or reserving a destination', () => {
    const store = new LayerRuntimeStore({ createRasterTexture: texture, createMaskTexture: texture });
    const document = createImageDocument('test', 64, 32, 'source');
    const first = document.layers[0] as RasterLayer;
    first.mask = {
      id: 'mask', enabled: true, linked: true, transform: first.transform,
      density: 1, feather: 0, revision: 0, pixelRevision: 0, dirtyBounds: null
    };
    const nested = { ...first, id: 'nested' as RasterLayer['id'], mask: null };
    const group = createGroupLayer('group');
    group.children = [nested];
    store.sync([first, group]);
    const pixels = store.raster(first.id)!.texture;
    const mask = store.maskTexture(first.id)!;
    expect(() => store.sync([
      { ...first, mask: null }, { ...group, children: [{ ...nested, width: 128 }] }
    ])).toThrow(/pixel surface/);
    expect(() => store.ensureRaster({ ...first, width: 128 })).toThrow(/pixel surface/);
    expect(store.raster(first.id)!.texture).toBe(pixels);
    expect(store.maskTexture(first.id)).toBe(mask);
    expect(pixels.destroy).not.toHaveBeenCalled();
    expect(mask.destroy).not.toHaveBeenCalled();
  });

  it('rebinds renderer facades without destroying another document pixels', () => {
    const repository = new DocumentLayerResourceRepository();
    const options = { createRasterTexture: texture, createMaskTexture: texture };
    const firstRenderer = new LayerRuntimeStore(options, repository);
    const secondRenderer = new LayerRuntimeStore(options, repository);
    const document = createImageDocument('test', 64, 64, 'source');
    const layer = document.layers[0] as RasterLayer;

    firstRenderer.bind('document-a');
    firstRenderer.sync(document.layers);
    const pixels = firstRenderer.raster(layer.id)?.texture;
    firstRenderer.destroy();
    secondRenderer.bind('document-a');

    expect(secondRenderer.raster(layer.id)?.texture).toBe(pixels);
    expect(pixels?.destroy).not.toHaveBeenCalled();
    repository.release('document-a');
    expect(pixels?.destroy).toHaveBeenCalledOnce();
  });

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

  it('prunes an explicitly named document without touching the active document', () => {
    const repository = new DocumentLayerResourceRepository();
    const store = new LayerRuntimeStore(
      { createRasterTexture: texture, createMaskTexture: texture },
      repository
    );
    const first = createImageDocument('first', 64, 64, 'first-source');
    const second = createImageDocument('second', 64, 64, 'second-source');
    const firstLayer = first.layers[0] as RasterLayer;
    const secondLayer = second.layers[0] as RasterLayer;

    store.bind(first.id);
    store.sync(first.layers);
    const firstPixels = store.raster(firstLayer.id)!.texture;
    store.bind(second.id);
    store.sync(second.layers);
    const secondPixels = store.raster(secondLayer.id)!.texture;

    expect(store.pruneDetachedFor(first.id, new Set())).toEqual([firstLayer.id]);
    expect(firstPixels.destroy).toHaveBeenCalledOnce();
    expect(secondPixels.destroy).not.toHaveBeenCalled();
    expect(store.raster(secondLayer.id)?.texture).toBe(secondPixels);
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
      linked: true,
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      density: 1,
      feather: 0,
      revision: 0,
      pixelRevision: 0,
      dirtyBounds: null
    };
    const group = createGroupLayer('group');
    group.mask = { ...raster.mask!, id: 'group-mask-a' };
    const vector = createVectorLayer([], 'shape');
    vector.mask = { ...raster.mask!, id: 'vector-mask-a' };

    store.sync([raster, group, vector]);
    const firstRasterMask = store.maskTexture(raster.id);
    const firstGroupMask = store.maskTexture(group.id);
    const firstVectorMask = store.maskTexture(vector.id);
    raster.mask = { ...raster.mask!, id: 'raster-mask-b' };
    group.mask = { ...group.mask!, id: 'group-mask-b' };
    vector.mask = { ...vector.mask!, id: 'vector-mask-b' };
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
      linked: true,
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      density: 1,
      feather: 0,
      revision: 0,
      pixelRevision: 0,
      dirtyBounds: null
    };
    store.sync(document.layers);

    expect(store.estimatedTextureBytes(10, 5)).toBe(10 * 5 * (8 + 2));
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

  it('exchanges tight and document pixel surfaces without disturbing the layer mask', () => {
    const store = new LayerRuntimeStore({
      createRasterTexture: texture,
      createMaskTexture: texture
    });
    const document = createImageDocument('test', 100, 80, 'source');
    const raster = document.layers[0] as RasterLayer;
    raster.width = 12;
    raster.height = 7;
    raster.mask = {
      id: 'mask', enabled: true, linked: true,
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }, density: 1, feather: 0,
      revision: 0, pixelRevision: 0, dirtyBounds: null
    };
    store.sync([raster]);
    const before = store.raster(raster.id)!;
    const beforeTexture = before.texture;
    const beforeMask = before.maskTexture;
    const replacement = texture();

    const displaced = store.exchangeRasterPixels(raster.id, {
      texture: replacement,
      width: 100,
      height: 80
    });

    expect(displaced).toEqual({ texture: beforeTexture, width: 12, height: 7 });
    expect(store.raster(raster.id)).toMatchObject({
      texture: replacement,
      width: 100,
      height: 80,
      maskTexture: beforeMask,
      maskId: 'mask'
    });
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
      linked: true,
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      density: 1,
      feather: 0,
      revision: 0,
      pixelRevision: 0,
      dirtyBounds: null
    };
    store.sync([text]);
    expect(store.estimatedTextureBytes(100, 80)).toBe(100 * 80 * 2);
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
