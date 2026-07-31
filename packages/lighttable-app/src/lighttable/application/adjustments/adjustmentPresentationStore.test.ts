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

  it('notifies only the affected panel domain during an interactive preview', () => {
    const initial = createDefaultAdjustments();
    const store = new AdjustmentPresentationStore(initial);
    const allListener = vi.fn();
    const gradeListener = vi.fn();
    const lensFxListener = vi.fn();
    store.subscribe(allListener);
    store.subscribeGrade(gradeListener);
    store.subscribeLensFx(lensFxListener);

    store.publish({ ...initial, exposureEV: 1 }, 'grade');

    expect(allListener).toHaveBeenCalledOnce();
    expect(gradeListener).toHaveBeenCalledOnce();
    expect(lensFxListener).not.toHaveBeenCalled();

    const gradeSnapshot = store.getSnapshot();
    store.publish({
      ...gradeSnapshot,
      effects: {
        ...gradeSnapshot.effects,
        grain: { ...gradeSnapshot.effects.grain, amount: 1.5 }
      }
    }, 'lens-fx');

    expect(allListener).toHaveBeenCalledTimes(2);
    expect(gradeListener).toHaveBeenCalledOnce();
    expect(lensFxListener).toHaveBeenCalledOnce();
  });

  it('notifies both panel domains for whole-grade replacement', () => {
    const initial = createDefaultAdjustments();
    const store = new AdjustmentPresentationStore(initial);
    const gradeListener = vi.fn();
    const lensFxListener = vi.fn();
    store.subscribeGrade(gradeListener);
    store.subscribeLensFx(lensFxListener);

    store.publish(createDefaultAdjustments(), 'all');

    expect(gradeListener).toHaveBeenCalledOnce();
    expect(lensFxListener).toHaveBeenCalledOnce();
  });
});
