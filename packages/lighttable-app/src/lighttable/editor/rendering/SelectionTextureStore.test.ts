import { describe, expect, it, vi } from 'vitest';
import { SelectionTextureStore } from './SelectionTextureStore';

const texture = () => ({ destroy: vi.fn() }) as unknown as GPUTexture;

describe('SelectionTextureStore', () => {
  it('allocates the selection channels once and can swap the working pair', () => {
    const createSelectionTexture = vi.fn(texture);
    const initializeTargets = vi.fn();
    const store = new SelectionTextureStore({
      createSelectionTexture,
      createClipboardTexture: texture,
      initializeTargets
    });
    expect(store.ensureTargets()).toBe(true);
    const firstMask = store.mask;
    const firstResult = store.result;
    expect(store.ensureTargets()).toBe(false);
    expect(createSelectionTexture).toHaveBeenCalledTimes(3);
    expect(initializeTargets).toHaveBeenCalledOnce();
    expect(initializeTargets).toHaveBeenCalledWith(firstMask, firstResult, store.shape);

    store.swapMaskAndResult();
    expect(store.mask).toBe(firstResult);
    expect(store.result).toBe(firstMask);
  });

  it('replaces clipboard ownership without disturbing selection channels', () => {
    const store = new SelectionTextureStore({
      createSelectionTexture: texture,
      createClipboardTexture: texture
    });
    store.ensureTargets();
    const first = store.replaceClipboard();
    const second = store.replaceClipboard();

    expect(first.destroy).toHaveBeenCalledOnce();
    expect(second).not.toBe(first);
    expect(store.mask).not.toBeNull();
  });

  it('reports and releases all owned channels', () => {
    const store = new SelectionTextureStore({
      createSelectionTexture: texture,
      createClipboardTexture: texture
    });
    store.ensureTargets();
    store.replaceClipboard();
    store.active = true;
    const resources = [store.mask, store.result, store.shape, store.clipboard];

    expect(store.estimatedTextureBytes(10, 5)).toBe(10 * 5 * (6 + 8));
    store.destroy();
    resources.forEach((resource) => expect(resource?.destroy).toHaveBeenCalledOnce());
    expect(store.active).toBe(false);
    expect(store.estimatedTextureBytes(10, 5)).toBe(0);
  });
});
