import { describe, expect, it, vi } from 'vitest';
import { createDefaultAdjustments } from '../../types';
import { AdjustmentPresentationStore } from './adjustmentPresentationStore';

describe('AdjustmentPresentationStore', () => {
  it('publishes a new document adjustment snapshot', () => {
    const initial = createDefaultAdjustments();
    const store = new AdjustmentPresentationStore(initial);
    const listener = vi.fn();
    store.subscribe(listener);
    const next = { ...initial, exposure: 1 };

    expect(store.publish(next)).toBe(true);
    expect(store.getSnapshot()).toBe(next);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('does not publish the same immutable snapshot twice', () => {
    const initial = createDefaultAdjustments();
    const store = new AdjustmentPresentationStore(initial);
    const listener = vi.fn();
    store.subscribe(listener);

    expect(store.publish(initial)).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('stops notifying an unsubscribed presentation', () => {
    const initial = createDefaultAdjustments();
    const store = new AdjustmentPresentationStore(initial);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();

    store.publish({ ...initial, contrast: 10 });
    expect(listener).not.toHaveBeenCalled();
  });
});
