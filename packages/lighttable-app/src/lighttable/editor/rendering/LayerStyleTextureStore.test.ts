import { describe, expect, it, vi } from 'vitest';
import type { LayerId } from '../document/documentTypes';
import { LayerStyleTextureStore } from './LayerStyleTextureStore';

const texture = () => ({ destroy: vi.fn() }) as unknown as GPUTexture;
const layerId = 'layer' as LayerId;
const options = (createTexture = vi.fn(texture)) => ({
  createTexture,
  createTextureSized: vi.fn(texture)
});

describe('LayerStyleTextureStore', () => {
  it('reuses work textures until their explicit release boundary', () => {
    const createTexture = vi.fn(texture);
    const store = new LayerStyleTextureStore(options(createTexture));

    const first = store.ensureWorkTextures();
    expect(store.ensureWorkTextures()).toBe(first);
    expect(createTexture).toHaveBeenCalledTimes(3);

    store.releaseWorkTextures();
    expect(first.shape.destroy).toHaveBeenCalledOnce();
    expect(first.first.destroy).toHaveBeenCalledOnce();
    expect(first.second.destroy).toHaveBeenCalledOnce();
    expect(store.ensureWorkTextures()).not.toBe(first);
  });

  it('keeps cache entries stable until their key changes or they are invalidated', () => {
    const storeOptions = options();
    const store = new LayerStyleTextureStore(storeOptions);
    const encoder = { copyTextureToTexture: vi.fn() } as unknown as GPUCommandEncoder;
    const source = texture();

    store.writeCache(encoder, layerId, 'first', 'Layer', source, { x: 4, y: 3, width: 20, height: 10 });
    const cached = store.cached(layerId, 'first');
    expect(cached).not.toBeNull();
    expect(storeOptions.createTextureSized).toHaveBeenCalledWith(
      'LightTable cached Layer Style: Layer', 20, 10
    );
    expect(encoder.copyTextureToTexture).toHaveBeenCalledWith(
      { texture: source, origin: { x: 4, y: 3 } },
      { texture: cached?.texture },
      [20, 10]
    );
    expect(store.cached(layerId, 'other')).toBeNull();

    store.writeCache(encoder, layerId, 'other', 'Layer', source, { x: 4, y: 3, width: 20, height: 10 });
    expect(store.cached(layerId, 'other')).toBe(cached);
    store.invalidate(layerId);
    expect(cached?.texture.destroy).toHaveBeenCalledOnce();
  });

  it('reallocates a tight cache only when its dimensions change', () => {
    const storeOptions = options();
    const store = new LayerStyleTextureStore(storeOptions);
    const encoder = { copyTextureToTexture: vi.fn() } as unknown as GPUCommandEncoder;
    store.writeCache(encoder, layerId, 'first', 'Layer', texture(), { x: 1, y: 2, width: 20, height: 10 });
    const first = store.cached(layerId, 'first')!;

    store.writeCache(encoder, layerId, 'moved', 'Layer', texture(), { x: 5, y: 6, width: 20, height: 10 });
    expect(store.cached(layerId, 'moved')?.texture).toBe(first.texture);
    expect(first.texture.destroy).not.toHaveBeenCalled();

    store.writeCache(encoder, layerId, 'resized', 'Layer', texture(), { x: 5, y: 6, width: 21, height: 10 });
    expect(first.texture.destroy).toHaveBeenCalledOnce();
    expect(storeOptions.createTextureSized).toHaveBeenCalledTimes(2);
  });

  it('reports cache and work-target ownership', () => {
    const store = new LayerStyleTextureStore(options());
    const encoder = { copyTextureToTexture: vi.fn() } as unknown as GPUCommandEncoder;
    store.ensureWorkTextures();
    store.writeCache(encoder, layerId, 'key', 'Layer', texture(), { x: 0, y: 0, width: 10, height: 5 });

    expect(store.estimatedTextureBytes(10, 5)).toBe(10 * 5 * 8 * 4);
  });
});
