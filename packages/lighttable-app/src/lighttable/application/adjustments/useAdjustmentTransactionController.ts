import { useEffect, useMemo, useRef } from 'react';
import type { DocumentId, LayerId } from '../../editor/document/documentTypes';
import {
  cloneAdjustments,
  type BasicAdjustments
} from '../../types';
import type { AdjustmentPresentationDomain } from './adjustmentPresentationStore';

export interface AdjustmentHistoryEntry {
  readonly label: string;
  readonly type: string;
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
  restoreStagedSnapshot(adjustments: BasicAdjustments): void;
  discardPreview(): void;
  pushHistoryEntry(entry: AdjustmentHistoryEntry): void;
  onCommitted?(commit: {
    readonly before: BasicAdjustments;
    readonly after: BasicAdjustments;
    readonly targetLayerId: LayerId | null;
    readonly domain: AdjustmentPresentationDomain;
  }): void;
}

export interface AdjustmentTransactionController {
  get active(): boolean;
  begin(): void;
  end(): void;
  cancel(): void;
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
  latest: BasicAdjustments;
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

  const pushHistory = (
    documentId: DocumentId | null,
    before: BasicAdjustments,
    after: BasicAdjustments,
    targetLayerId: LayerId | null,
    domain: AdjustmentPresentationDomain
  ) => {
    const previous = cloneAdjustments(before);
    const next = cloneAdjustments(after);
    resolveDependencies().pushHistoryEntry({
      label: targetLayerId ? 'Edit Adjustment Layer' : 'Edit Adjustments',
      type: targetLayerId ? 'adjustment.layer.edit' : 'adjustment.document.edit',
      undo: () => {
        const dependencies = resolveDependencies();
        if (dependencies.getDocumentId() !== documentId) {
          throw new Error('The grade belongs to a different document.');
        }
        dependencies.commitSnapshot(cloneAdjustments(previous), targetLayerId, domain);
      },
      redo: () => {
        const dependencies = resolveDependencies();
        if (dependencies.getDocumentId() !== documentId) {
          throw new Error('The grade belongs to a different document.');
        }
        dependencies.commitSnapshot(cloneAdjustments(next), targetLayerId, domain);
      }
    });
  };

  const cancel = () => {
    const completed = transaction;
    transaction = null;
    const dependencies = resolveDependencies();
    if (completed && dependencies.getDocumentId() === completed.documentId) {
      dependencies.restoreStagedSnapshot(cloneAdjustments(completed.before));
    }
    dependencies.discardPreview();
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
    if (dependencies.getDocumentId() !== completed.documentId
      || dependencies.getActiveTargetLayerId() !== completed.targetLayerId) {
      if (dependencies.getDocumentId() === completed.documentId) {
        dependencies.restoreStagedSnapshot(cloneAdjustments(completed.before));
      }
      dependencies.discardPreview();
      return;
    }
    const after = cloneAdjustments(completed.latest);
    if (!adjustmentsEqual(completed.before, after)) {
      dependencies.commitSnapshot(after, completed.targetLayerId, completed.domain);
      try {
        pushHistory(
          completed.documentId,
          completed.before,
          after,
          completed.targetLayerId,
          completed.domain
        );
      } catch (error) {
        dependencies.commitSnapshot(
          cloneAdjustments(completed.before),
          completed.targetLayerId,
          completed.domain
        );
        throw error;
      }
      dependencies.onCommitted?.({
        before: cloneAdjustments(completed.before),
        after: cloneAdjustments(after),
        targetLayerId: completed.targetLayerId,
        domain: completed.domain
      });
    } else {
      dependencies.discardPreview();
    }
  };

  return {
    get active() {
      return transaction !== null;
    },
    begin: () => {
      const dependencies = resolveDependencies();
      const documentId = dependencies.getDocumentId();
      const targetLayerId = dependencies.getActiveTargetLayerId();
      if (transaction) {
        if (transaction.documentId === documentId
          && transaction.targetLayerId === targetLayerId) return;
        // Pointer capture can be lost when a contextual panel is replaced.
        // A later interaction must never inherit that transaction's owner.
        cancel();
      }
      const before = cloneAdjustments(dependencies.getAdjustments());
      transaction = {
        documentId,
        targetLayerId,
        before,
        latest: cloneAdjustments(before),
        domain: 'grade'
      };
      setInteractiveQuality(true);
    },
    end,
    cancel,
    reset: cancel,
    change: (mutate, domain = 'grade') => {
      const dependencies = resolveDependencies();
      if (transaction && dependencies.getDocumentId() !== transaction.documentId) {
        cancel();
        return false;
      }
      if (transaction
        && dependencies.getActiveTargetLayerId() !== transaction.targetLayerId) {
        cancel();
        return false;
      }
      // Adjustment snapshots are immutable at this boundary. Keep the current
      // reference and clone only the value handed to the mutator. During a
      // pointer gesture the final comparison in end() is sufficient; serializing
      // the complete adjustment tree for every pointer event made sliders do
      // avoidable main-thread work, especially on lower-power Macs.
      const before = transaction?.latest ?? dependencies.getAdjustments();
      const next = mutate(cloneAdjustments(before));
      if (!transaction && adjustmentsEqual(before, next)) return false;
      const documentId = dependencies.getDocumentId();
      const targetLayerId = transaction?.targetLayerId
        ?? dependencies.getActiveTargetLayerId();
      if (transaction) {
        transaction.domain = domain;
        transaction.latest = cloneAdjustments(next);
        dependencies.previewSnapshot(next, targetLayerId, domain);
      } else {
        dependencies.commitSnapshot(next, targetLayerId, domain);
      }
      if (!transaction) {
        try {
          pushHistory(documentId, before, next, targetLayerId, domain);
        } catch (error) {
          dependencies.commitSnapshot(cloneAdjustments(before), targetLayerId, domain);
          throw error;
        }
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
  const controller = useMemo(
    () => createAdjustmentTransactionController(() => dependenciesRef.current),
    []
  );
  useEffect(() => () => controller.cancel(), [controller]);
  return controller;
};
