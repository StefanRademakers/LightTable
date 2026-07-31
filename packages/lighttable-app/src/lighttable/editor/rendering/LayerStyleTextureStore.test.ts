import { describe, expect, it, vi } from 'vitest';
import type { LayerId } from '../document/documentTypes';
import { LayerStyleTextureStore } from './LayerStyleTextureStore';

const texture = () => ({ destroy: vi.fn() }) as unknown as GPUTexture;
const layerId = 'layer' as LayerId;

describe('LayerStyleTextureStore', () => {
  it('reuses work textures until their explicit release boundary', () => {
    const createTexture = vi.fn(texture);
    const store = new LayerStyleTextureStore({ createTexture });

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
    const store = new LayerStyleTextureStore({ createTexture: texture });
    const encoder = { copyTextureToTexture: vi.fn() } as unknown as GPUCommandEncoder;
    const source = texture();

    store.writeCache(encoder, layerId, 'first', 'Layer', source, [20, 10]);
    const cached = store.cached(layerId, 'first');
    expect(cached).not.toBeNull();
    expect(store.cached(layerId, 'other')).toBeNull();

    store.writeCache(encoder, layerId, 'other', 'Layer', source, [20, 10]);
    expect(store.cached(layerId, 'other')).toBe(cached);
    store.invalidate(layerId);
    expect(cached?.destroy).toHaveBeenCalledOnce();
  });

  it('reports cache and work-target ownership', () => {
    const store = new LayerStyleTextureStore({ createTexture: texture });
    const encoder = { copyTextureToTexture: vi.fn() } as unknown as GPUCommandEncoder;
    store.ensureWorkTextures();
    store.writeCache(encoder, layerId, 'key', 'Layer', texture(), [10, 5]);

    expect(store.estimatedTextureBytes(10, 5)).toBe(10 * 5 * 8 * 4);
  });
});
