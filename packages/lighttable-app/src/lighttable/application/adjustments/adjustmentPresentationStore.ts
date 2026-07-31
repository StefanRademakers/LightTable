import { useSyncExternalStore } from 'react';
import type { BasicAdjustments } from '../../types';

type AdjustmentListener = () => void;
export type AdjustmentPresentationDomain = 'grade' | 'lens-fx' | 'all';

/**
 * Document-scoped presentation store for the editor's current adjustment
 * snapshot. The WebGPU renderer remains the authority for rendering; this
 * store keeps high-frequency slider publications out of the editor shell's
 * React state.
 */
export class AdjustmentPresentationStore {
  private snapshot: BasicAdjustments;
  private readonly listeners = new Set<AdjustmentListener>();
  private readonly gradeListeners = new Set<AdjustmentListener>();
  private readonly lensFxListeners = new Set<AdjustmentListener>();

  constructor(initialSnapshot: BasicAdjustments) {
    this.snapshot = initialSnapshot;
  }

  readonly subscribe = (listener: AdjustmentListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly subscribeGrade = (listener: AdjustmentListener): (() => void) => {
    this.gradeListeners.add(listener);
    return () => this.gradeListeners.delete(listener);
  };

  readonly subscribeLensFx = (listener: AdjustmentListener): (() => void) => {
    this.lensFxListeners.add(listener);
    return () => this.lensFxListeners.delete(listener);
  };

  readonly getSnapshot = (): BasicAdjustments => this.snapshot;

  publish(
    snapshot: BasicAdjustments,
    domain: AdjustmentPresentationDomain = 'all'
  ): boolean {
    if (Object.is(snapshot, this.snapshot)) return false;
    this.snapshot = snapshot;
    this.listeners.forEach((listener) => listener());
    if (domain === 'grade' || domain === 'all') {
      this.gradeListeners.forEach((listener) => listener());
    }
    if (domain === 'lens-fx' || domain === 'all') {
      this.lensFxListeners.forEach((listener) => listener());
    }
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

export const useGradePresentation = (
  store: AdjustmentPresentationStore
): BasicAdjustments => useSyncExternalStore(
  store.subscribeGrade,
  store.getSnapshot,
  store.getSnapshot
);

export const useLensFxPresentation = (
  store: AdjustmentPresentationStore
): BasicAdjustments => useSyncExternalStore(
  store.subscribeLensFx,
  store.getSnapshot,
  store.getSnapshot
);
