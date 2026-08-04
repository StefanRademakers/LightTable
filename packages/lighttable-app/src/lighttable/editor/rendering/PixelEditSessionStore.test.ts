import { describe, expect, it, vi } from 'vitest';
import type { LayerId } from '../document/documentTypes';
import {
  PixelEditSessionStore,
  type PixelEditSnapshot
} from './PixelEditSessionStore';

const texture = () => ({ destroy: vi.fn() }) as unknown as GPUTexture;
const snapshot = (layerId = 'layer-1'): PixelEditSnapshot => ({
  layerId: layerId as LayerId,
  channel: 'pixels',
  texture: texture(),
  width: 20,
  height: 10
});

describe('PixelEditSessionStore', () => {
  it('releases an abandoned snapshot when a new edit starts', () => {
    const store = new PixelEditSessionStore();
    const first = snapshot();
    const second = snapshot('layer-2');

    store.begin(first);
    store.begin(second);

    expect(first.texture.destroy).toHaveBeenCalledOnce();
    expect(store.current).toBe(second);
  });

  it('transfers a completed snapshot to history without destroying it', () => {
    const store = new PixelEditSessionStore();
    const active = snapshot();
    store.begin(active);

    expect(store.complete()).toBe(active);
    expect(active.texture.destroy).not.toHaveBeenCalled();
    expect(store.current).toBeNull();
  });

  it('accounts for and releases a cancelled edit', () => {
    const store = new PixelEditSessionStore();
    const active = snapshot();
    store.begin(active);

    expect(store.estimatedTextureBytes(80)).toBe(20 * 10 * 8);
    expect(store.cancel()).toBe(true);
    expect(active.texture.destroy).toHaveBeenCalledOnce();
    expect(store.estimatedTextureBytes(80)).toBe(0);
    expect(store.cancel()).toBe(false);
  });

  it('accounts for a single-channel mask snapshot', () => {
    const store = new PixelEditSessionStore();
    store.begin({ ...snapshot(), channel: 'mask' });

    expect(store.estimatedTextureBytes(80)).toBe(20 * 10);
  });
});
