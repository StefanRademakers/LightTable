import { useSyncExternalStore } from 'react';
import type { BasicAdjustments } from '../../types';

type AdjustmentListener = () => void;

/**
 * Document-scoped presentation store for the editor's current adjustment
 * snapshot. The WebGPU renderer remains the authority for rendering; this
 * store keeps high-frequency slider publications out of the editor shell's
 * React state.
 */
export class AdjustmentPresentationStore {
  private snapshot: BasicAdjustments;
  private readonly listeners = new Set<AdjustmentListener>();

  constructor(initialSnapshot: BasicAdjustments) {
    this.snapshot = initialSnapshot;
  }

  readonly subscribe = (listener: AdjustmentListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): BasicAdjustments => this.snapshot;

  publish(snapshot: BasicAdjustments): boolean {
    if (Object.is(snapshot, this.snapshot)) return false;
    this.snapshot = snapshot;
    this.listeners.forEach((listener) => listener());
    return true;
  }
}

export const useAdjustmentPresentation = (
  store: AdjustmentPresentationStore
): BasicAdjustments => useSyncExternalStore(
  store.subscribe,
  store.getSnapshot,
  store.getSnapshot
);

export const useAdjustmentPresentationSelector = <Value,>(
  store: AdjustmentPresentationStore,
  selector: (adjustments: BasicAdjustments) => Value
): Value => useSyncExternalStore(
  store.subscribe,
  () => selector(store.getSnapshot()),
  () => selector(store.getSnapshot())
);
