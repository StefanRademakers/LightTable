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

  it('exchanges and rolls back a complete projection without moving clipboard ownership', () => {
    const committed = new SelectionTextureStore({
      createSelectionTexture: texture,
      createClipboardTexture: texture
    });
    const prepared = new SelectionTextureStore({
      createSelectionTexture: texture,
      createClipboardTexture: texture
    });
    committed.ensureTargets();
    prepared.ensureTargets();
    const clipboard = committed.replaceClipboard();
    committed.active = false;
    prepared.active = true;
    const original = {
      mask: committed.mask,
      result: committed.result,
      shape: committed.shape
    };

    const rollback = committed.exchangeState(prepared.detachState());
    expect(committed.active).toBe(true);
    expect(committed.mask).not.toBe(original.mask);
    expect(committed.clipboard).toBe(clipboard);

    const rejected = committed.exchangeState(rollback);
    expect(committed.active).toBe(false);
    expect(committed.mask).toBe(original.mask);
    expect(committed.result).toBe(original.result);
    expect(committed.shape).toBe(original.shape);
    expect(committed.clipboard).toBe(clipboard);
    SelectionTextureStore.destroyState(rejected);
    expect(rejected.mask.destroy).toHaveBeenCalledOnce();
    expect(rejected.result.destroy).toHaveBeenCalledOnce();
    expect(rejected.shape.destroy).toHaveBeenCalledOnce();
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

  it('keeps a newer preview lease locked when an older release arrives late', () => {
    const store = new SelectionTextureStore({
      createSelectionTexture: texture,
      createClipboardTexture: texture
    });
    const first = store.beginPreviewMutation();
    expect(first).not.toBeNull();
    expect(store.beginPreviewMutation()).toBeNull();
    expect(() => store.assertCommittedAccess()).toThrow('still being previewed');

    first!.release();
    const second = store.beginPreviewMutation();
    expect(second).not.toBeNull();
    first!.release();
    expect(() => store.assertCommittedAccess()).toThrow('still being previewed');

    expect(second!.run(() => 42)).toBe(42);
    second!.release();
    expect(() => store.assertCommittedAccess()).not.toThrow();
    expect(() => second!.run(() => 42)).toThrow('no longer active');
  });

  it('rejects committed target mutation while preview owns the store', () => {
    const store = new SelectionTextureStore({
      createSelectionTexture: texture,
      createClipboardTexture: texture
    });
    store.ensureTargets();
    const originalMask = store.mask;
    const originalResult = store.result;
    const lease = store.beginPreviewMutation()!;

    expect(() => store.swapMaskAndResult()).toThrow('still being previewed');
    expect(() => store.exchangeState({
      mask: texture(), result: texture(), shape: texture(), active: true
    })).toThrow('still being previewed');
    expect(store.mask).toBe(originalMask);
    expect(store.result).toBe(originalResult);

    lease.run(() => store.swapMaskAndResult());
    expect(store.mask).toBe(originalResult);
    expect(store.result).toBe(originalMask);
    lease.release();
  });
});
