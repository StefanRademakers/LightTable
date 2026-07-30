import { useMemo, useRef } from 'react';
import type { DocumentId, LayerId } from '../../editor/document/documentTypes';
import {
  cloneAdjustments,
  type BasicAdjustments
} from '../../types';

export interface AdjustmentHistoryEntry {
  undo(): void;
  redo(): void;
}

export interface AdjustmentInteractionRendererPort {
  setScopeInteractionActive(active: boolean): void;
  setLensBlurInteractionActive(active: boolean): void;
}

export interface AdjustmentTransactionDependencies {
  getDocumentId(): DocumentId | null;
  getAdjustments(): BasicAdjustments;
  getActiveTargetLayerId(): LayerId | null;
  getRenderer(): AdjustmentInteractionRendererPort | null;
  applySnapshot(adjustments: BasicAdjustments, targetLayerId: LayerId | null): void;
  pushHistoryEntry(entry: AdjustmentHistoryEntry): void;
}

export interface AdjustmentTransactionController {
  get active(): boolean;
  begin(): void;
  end(): void;
  reset(): void;
  change(mutate: (current: BasicAdjustments) => BasicAdjustments): boolean;
}

interface ActiveAdjustmentTransaction {
  documentId: DocumentId | null;
  targetLayerId: LayerId | null;
  before: BasicAdjustments;
}

const adjustmentsEqual = (left: BasicAdjustments, right: BasicAdjustments) =>
  JSON.stringify(left) === JSON.stringify(right);

/**
 * Owns the complete interaction transaction for grade and Lens Fx controls.
 *
 * The document and Adjustment Layer target are locked at interaction start.
 * A slider can emit any number of preview changes, but completion records one
 * history command. Switching documents cannot publish that command into the
 * newly active session.
 */
export const createAdjustmentTransactionController = (
  resolveDependencies: () => AdjustmentTransactionDependencies
): AdjustmentTransactionController => {
  let transaction: ActiveAdjustmentTransaction | null = null;

  const setInteractiveQuality = (active: boolean) => {
    const renderer = resolveDependencies().getRenderer();
    renderer?.setScopeInteractionActive(active);
    renderer?.setLensBlurInteractionActive(active);
  };

  const applyForDocument = (
    documentId: DocumentId | null,
    adjustments: BasicAdjustments,
    targetLayerId: LayerId | null
  ) => {
    const dependencies = resolveDependencies();
    if (dependencies.getDocumentId() !== documentId) {
      throw new Error('The grade belongs to a different document.');
    }
    dependencies.applySnapshot(cloneAdjustments(adjustments), targetLayerId);
  };

  const pushHistory = (
    documentId: DocumentId | null,
    before: BasicAdjustments,
    after: BasicAdjustments,
    targetLayerId: LayerId | null
  ) => {
    const previous = cloneAdjustments(before);
    const next = cloneAdjustments(after);
    resolveDependencies().pushHistoryEntry({
      undo: () => applyForDocument(documentId, previous, targetLayerId),
      redo: () => applyForDocument(documentId, next, targetLayerId)
    });
  };

  const reset = () => {
    transaction = null;
    setInteractiveQuality(false);
  };

  const end = () => {
    if (!transaction) {
      setInteractiveQuality(false);
      return;
    }
    const completed = transaction;
    transaction = null;
    setInteractiveQuality(false);
    const dependencies = resolveDependencies();
    if (dependencies.getDocumentId() !== completed.documentId) return;
    const after = cloneAdjustments(dependencies.getAdjustments());
    if (!adjustmentsEqual(completed.before, after)) {
      pushHistory(
        completed.documentId,
        completed.before,
        after,
        completed.targetLayerId
      );
    }
  };

  return {
    get active() {
      return transaction !== null;
    },
    begin: () => {
      if (transaction) return;
      const dependencies = resolveDependencies();
      transaction = {
        documentId: dependencies.getDocumentId(),
        targetLayerId: dependencies.getActiveTargetLayerId(),
        before: cloneAdjustments(dependencies.getAdjustments())
      };
      setInteractiveQuality(true);
    },
    end,
    reset,
    change: (mutate) => {
      const dependencies = resolveDependencies();
      if (transaction && dependencies.getDocumentId() !== transaction.documentId) {
        reset();
        return false;
      }
      const before = cloneAdjustments(dependencies.getAdjustments());
      const next = mutate(cloneAdjustments(before));
      if (adjustmentsEqual(before, next)) return false;
      const documentId = dependencies.getDocumentId();
      const targetLayerId = transaction?.targetLayerId
        ?? dependencies.getActiveTargetLayerId();
      dependencies.applySnapshot(next, targetLayerId);
      if (!transaction) {
        pushHistory(documentId, before, next, targetLayerId);
      }
      return true;
    }
  };
};

export const useAdjustmentTransactionController = (
  dependencies: AdjustmentTransactionDependencies
): AdjustmentTransactionController => {
  const dependenciesRef = useRef(dependencies);
  dependenciesRef.current = dependencies;
  return useMemo(
    () => createAdjustmentTransactionController(() => dependenciesRef.current),
    []
  );
};
