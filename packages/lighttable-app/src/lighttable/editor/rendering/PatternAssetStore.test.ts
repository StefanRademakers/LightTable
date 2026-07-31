import { describe, expect, it, vi } from 'vitest';
import type { DocumentAssetId } from '../document/documentTypes';
import { PatternAssetStore } from './PatternAssetStore';

const id = 'pattern-1' as DocumentAssetId;
const texture = (width = 4, height = 3) => ({
  width,
  height,
  destroy: vi.fn()
}) as unknown as GPUTexture;

describe('PatternAssetStore', () => {
  it('keeps source and decoded texture under one stable asset id', () => {
    const store = new PatternAssetStore();
    const source = new Blob(['pattern']);
    const decoded = texture();

    store.set(id, source, decoded);

    expect(store.getSource(id)).toBe(source);
    expect(store.getTexture(id)).toBe(decoded);
    expect(store.estimatedTextureBytes()).toBe(4 * 3 * 8);
  });

  it('releases the previous texture when an asset is replaced', () => {
    const store = new PatternAssetStore();
    const first = texture();
    const second = texture();
    store.set(id, new Blob(['first']), first);
    store.set(id, new Blob(['second']), second);

    expect(first.destroy).toHaveBeenCalledOnce();
    expect(second.destroy).not.toHaveBeenCalled();
  });

  it('destroys every owned texture exactly once', () => {
    const store = new PatternAssetStore();
    const first = texture();
    const second = texture();
    store.set(id, new Blob(), first);
    store.set('pattern-2' as DocumentAssetId, new Blob(), second);

    store.destroy();

    expect(first.destroy).toHaveBeenCalledOnce();
    expect(second.destroy).toHaveBeenCalledOnce();
    expect(store.getTexture(id)).toBeNull();
  });
});
