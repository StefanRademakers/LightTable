import { useMemo, useRef } from 'react';
import type { DocumentId, LayerId } from '../../editor/document/documentTypes';
import {
  cloneAdjustments,
  type BasicAdjustments
} from '../../types';
import type { AdjustmentPresentationDomain } from './adjustmentPresentationStore';

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
  previewSnapshot(
    adjustments: BasicAdjustments,
    targetLayerId: LayerId | null,
    domain: AdjustmentPresentationDomain
  ): void;
  commitSnapshot(
    adjustments: BasicAdjustments,
    targetLayerId: LayerId | null,
    domain: AdjustmentPresentationDomain
  ): void;
  pushHistoryEntry(entry: AdjustmentHistoryEntry): void;
}

export interface AdjustmentTransactionController {
  get active(): boolean;
  begin(): void;
  end(): void;
  reset(): void;
  change(
    mutate: (current: BasicAdjustments) => BasicAdjustments,
    domain?: AdjustmentPresentationDomain
  ): boolean;
}

interface ActiveAdjustmentTransaction {
  documentId: DocumentId | null;
  targetLayerId: LayerId | null;
  before: BasicAdjustments;
  domain: AdjustmentPresentationDomain;
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
    dependencies.commitSnapshot(cloneAdjustments(adjustments), targetLayerId, 'all');
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
      dependencies.commitSnapshot(after, completed.targetLayerId, completed.domain);
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
        before: cloneAdjustments(dependencies.getAdjustments()),
        domain: 'grade'
      };
      setInteractiveQuality(true);
    },
    end,
    reset,
    change: (mutate, domain = 'grade') => {
      const dependencies = resolveDependencies();
      if (transaction && dependencies.getDocumentId() !== transaction.documentId) {
        reset();
        return false;
      }
      // Adjustment snapshots are immutable at this boundary. Keep the current
      // reference and clone only the value handed to the mutator. During a
      // pointer gesture the final comparison in end() is sufficient; serializing
      // the complete adjustment tree for every pointer event made sliders do
      // avoidable main-thread work, especially on lower-power Macs.
      const before = dependencies.getAdjustments();
      const next = mutate(cloneAdjustments(before));
      if (!transaction && adjustmentsEqual(before, next)) return false;
      const documentId = dependencies.getDocumentId();
      const targetLayerId = transaction?.targetLayerId
        ?? dependencies.getActiveTargetLayerId();
      if (transaction) {
        transaction.domain = domain;
        dependencies.previewSnapshot(next, targetLayerId, domain);
      } else {
        dependencies.commitSnapshot(next, targetLayerId, domain);
      }
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
