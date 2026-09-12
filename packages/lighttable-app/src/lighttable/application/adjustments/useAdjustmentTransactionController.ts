import { useEffect, useMemo, useRef } from 'react';
import type { DocumentId, ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { cloneAdjustments, type BasicAdjustments } from '../../types';
import type { DocumentMutationController, DocumentMutationTransaction } from '../documents/useDocumentMutationController';
import type { AdjustmentPresentationDomain } from './adjustmentPresentationStore';
import { projectAdjustmentDelta } from './projectAdjustmentSnapshot';

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
  getDocument(): ImageDocument | null;
  getDocumentAdjustments(): BasicAdjustments;
  /** Materializes the exact current canonical owner; presentation caches are output-only. */
  getCanonicalAdjustments(): BasicAdjustments | null;
  getActiveTargetLayerId(): LayerId | null;
  /** Stable semantic owner identity, including contextual sub-owner/domain. */
  getActiveTargetIdentity(): string | null;
  getRenderer(): AdjustmentInteractionRendererPort | null;
  getRendererGeneration(): number;
  readonly documentMutations: Pick<DocumentMutationController, 'begin' | 'change'>;
  /** Document-wide processing preview. Layer previews use the document mutation projection. */
  previewDocumentProcessing(
    adjustments: BasicAdjustments,
    domain: AdjustmentPresentationDomain
  ): void;
  /** Document-wide processing commit/restore. Layer commits use the document mutation owner. */
  commitDocumentProcessing(
    adjustments: BasicAdjustments,
    domain: AdjustmentPresentationDomain
  ): void;
  stageEditorAdjustments(adjustments: BasicAdjustments): void;
  restoreStagedSnapshot(adjustments: BasicAdjustments): void;
  discardPreview(): void;
  /** History authority for document-wide processing only. */
  pushProcessingHistoryEntry(entry: AdjustmentHistoryEntry): void;
  onCommitted?(commit: {
    readonly before: BasicAdjustments;
    readonly after: BasicAdjustments;
    readonly targetLayerId: LayerId | null;
    readonly domain: AdjustmentPresentationDomain;
  }): void;
}

export interface AdjustmentTransactionController {
  get active(): boolean;
  begin(): AdjustmentInteractionToken | null;
  end(token: AdjustmentInteractionToken): AdjustmentTerminalResult;
  cancel(token: AdjustmentInteractionToken): void;
  reset(): void;
  change(
    mutate: (current: BasicAdjustments) => BasicAdjustments,
    domain?: AdjustmentPresentationDomain,
    token?: AdjustmentInteractionToken
  ): boolean;
  changeResult(
    mutate: (current: BasicAdjustments) => BasicAdjustments,
    domain?: AdjustmentPresentationDomain,
    token?: AdjustmentInteractionToken
  ): AdjustmentChangeResult;
}

export type AdjustmentTerminalResult = 'committed' | 'unchanged' | 'rejected';
export type AdjustmentChangeResult = 'applied' | 'unchanged' | 'rejected';

/** Opaque ownership lease for one adjustment gesture. */
export interface AdjustmentInteractionToken {
  readonly sequence: number;
}

interface ActiveAdjustmentTransaction {
  readonly token: AdjustmentInteractionToken;
  readonly documentId: DocumentId;
  readonly targetLayerId: LayerId | null;
  readonly targetIdentity: string | null;
  readonly before: BasicAdjustments;
  readonly documentTransaction: DocumentMutationTransaction | null;
  readonly renderer: AdjustmentInteractionRendererPort;
  readonly rendererGeneration: number;
  latest: BasicAdjustments;
  domain: AdjustmentPresentationDomain;
}

const adjustmentsEqual = (left: BasicAdjustments, right: BasicAdjustments) =>
  JSON.stringify(left) === JSON.stringify(right);

/**
 * Owns adjustment gestures without creating a second layer/history authority.
 *
 * Layer and attached-adjustment previews are staged by the shared document
 * transaction and commit through its history. Only document-wide Grade/Lens
 * processing uses the separate processing publisher/history entry because that
 * state deliberately lives outside ImageDocument.
 */
export const createAdjustmentTransactionController = (
  resolveDependencies: () => AdjustmentTransactionDependencies
): AdjustmentTransactionController => {
  let active: ActiveAdjustmentTransaction | null = null;
  let rejectedGesture = false;
  let rejectedToken: AdjustmentInteractionToken | null = null;
  let tokenSequence = 0;

  const setInteractiveQuality = (
    enabled: boolean,
    renderer = resolveDependencies().getRenderer()
  ) => {
    renderer?.setScopeInteractionActive(enabled);
    renderer?.setLensBlurInteractionActive(enabled);
  };

  const targetStillMatches = (transaction: ActiveAdjustmentTransaction) => {
    const dependencies = resolveDependencies();
    return dependencies.getDocumentId() === transaction.documentId
      && dependencies.getActiveTargetLayerId() === transaction.targetLayerId
      && dependencies.getActiveTargetIdentity() === transaction.targetIdentity
      && dependencies.getRenderer() === transaction.renderer
      && dependencies.getRendererGeneration() === transaction.rendererGeneration;
  };

  const finishLocalState = (transaction: ActiveAdjustmentTransaction) => {
    if (active === transaction) active = null;
    setInteractiveQuality(false, transaction.renderer);
  };

  const pushDocumentProcessingHistory = (
    transaction: ActiveAdjustmentTransaction,
    after: BasicAdjustments
  ) => {
    const previous = cloneAdjustments(transaction.before);
    const next = cloneAdjustments(after);
    const apply = (snapshot: BasicAdjustments) => {
      const dependencies = resolveDependencies();
      if (dependencies.getDocumentId() !== transaction.documentId) {
        throw new Error('The processing adjustment belongs to a different document.');
      }
      dependencies.commitDocumentProcessing(cloneAdjustments(snapshot), transaction.domain);
    };
    resolveDependencies().pushProcessingHistoryEntry({
      label: 'Edit Adjustments',
      type: 'adjustment.document.edit',
      undo: () => apply(previous),
      redo: () => apply(next)
    });
  };

  const cancelActive = () => {
    rejectedGesture = false;
    rejectedToken = null;
    const transaction = active;
    active = null;
    if (!transaction) {
      setInteractiveQuality(false);
      return;
    }
    if (transaction.documentTransaction?.active) transaction.documentTransaction.cancel();
    const dependencies = resolveDependencies();
    if (dependencies.getDocumentId() === transaction.documentId) {
      dependencies.restoreStagedSnapshot(cloneAdjustments(transaction.before));
    }
    dependencies.discardPreview();
    setInteractiveQuality(false, transaction.renderer);
    // A deliberate UI cancel ends the gesture. Only an external transaction
    // interruption is allowed to latch rejection until the matching terminal.
    rejectedGesture = false;
  };

  const endActive = (): AdjustmentTerminalResult => {
    rejectedGesture = false;
    const transaction = active;
    if (!transaction) {
      setInteractiveQuality(false);
      return 'rejected';
    }
    if (!targetStillMatches(transaction)) {
      cancelActive();
      return 'rejected';
    }
    const after = cloneAdjustments(transaction.latest);
    if (adjustmentsEqual(transaction.before, after)) {
      cancelActive();
      return 'unchanged';
    }
    if (transaction.documentTransaction) {
      // Retire the presentation owner before canonical publication. The shared
      // applyDocumentSnapshot boundary resets stale adjustment gestures; it
      // must not mistake this transaction's own terminal publication for an
      // external cancellation and briefly restore the opening preview.
      active = null;
      let committed = false;
      try {
        committed = transaction.documentTransaction.commit();
      } finally {
        setInteractiveQuality(false, transaction.renderer);
      }
      if (!committed) {
        const dependencies = resolveDependencies();
        if (dependencies.getDocumentId() === transaction.documentId) {
          dependencies.restoreStagedSnapshot(cloneAdjustments(transaction.before));
        }
        dependencies.discardPreview();
        return 'rejected';
      }
    } else {
      const dependencies = resolveDependencies();
      try {
        dependencies.commitDocumentProcessing(after, transaction.domain);
        pushDocumentProcessingHistory(transaction, after);
      } catch (error) {
        dependencies.commitDocumentProcessing(
          cloneAdjustments(transaction.before),
          transaction.domain
        );
        finishLocalState(transaction);
        throw error;
      }
      finishLocalState(transaction);
    }
    resolveDependencies().onCommitted?.({
      before: cloneAdjustments(transaction.before),
      after,
      targetLayerId: transaction.targetLayerId,
      domain: transaction.domain
    });
    return 'committed';
  };

  const rejectGesture = (token: AdjustmentInteractionToken | null = null) => {
    rejectedGesture = true;
    rejectedToken = token;
    return false;
  };

  const begin = (): AdjustmentInteractionToken | null => {
    const dependencies = resolveDependencies();
    const document = dependencies.getDocument();
    const documentId = dependencies.getDocumentId();
    const renderer = dependencies.getRenderer();
    if (rejectedGesture) return null;
    if (!document || !documentId || !renderer) {
      rejectGesture();
      return null;
    }
    const rendererGeneration = dependencies.getRendererGeneration();
    const targetLayerId = dependencies.getActiveTargetLayerId();
    const targetIdentity = dependencies.getActiveTargetIdentity();
    if (active) {
      const rendererChanged = active.renderer !== renderer
        || active.rendererGeneration !== rendererGeneration;
      cancelActive();
      if (rendererChanged) {
        rejectGesture();
        return null;
      }
    }
    let transaction: ActiveAdjustmentTransaction | null = null;
    let documentTransaction: DocumentMutationTransaction | null = null;
    if (targetLayerId) {
      documentTransaction = dependencies.documentMutations.begin(
        'adjustment.layer',
        { label: 'Edit Adjustment Layer', type: 'adjustment.layer.edit', layerIds: [
          targetLayerId
        ] },
        (reason) => {
          if (!transaction || active !== transaction) return;
          active = null;
          if (reason !== 'commit') {
            rejectedGesture = true;
            rejectedToken = transaction.token;
          }
          if (reason !== 'commit'
            && resolveDependencies().getDocumentId() === transaction.documentId) {
            resolveDependencies().restoreStagedSnapshot(
              cloneAdjustments(transaction.before)
            );
            resolveDependencies().discardPreview();
          }
          setInteractiveQuality(false, transaction.renderer);
        },
        'cancel'
      );
      if (!documentTransaction) {
        rejectGesture();
        return null;
      }
    }
    const canonical = dependencies.getCanonicalAdjustments();
    if (!canonical) {
      documentTransaction?.cancel();
      rejectGesture();
      return null;
    }
    const before = cloneAdjustments(canonical);
    const token: AdjustmentInteractionToken = { sequence: ++tokenSequence };
    transaction = {
      token,
      documentId,
      targetLayerId,
      targetIdentity,
      before,
      latest: cloneAdjustments(before),
      domain: 'grade',
      documentTransaction,
      renderer,
      rendererGeneration
    };
    active = transaction;
    setInteractiveQuality(true, renderer);
    return token;
  };

  const changeResult = (
    mutate: (current: BasicAdjustments) => BasicAdjustments,
    domain: AdjustmentPresentationDomain = 'grade',
    token?: AdjustmentInteractionToken
  ): AdjustmentChangeResult => {
    const dependencies = resolveDependencies();
    if (rejectedGesture) return 'rejected';
    if (active && token !== active.token) return 'rejected';
    if (!active && token) return 'rejected';
    if (active && !targetStillMatches(active)) {
      const rejectedActiveToken = active.token;
      cancelActive();
      rejectGesture(rejectedActiveToken);
      return 'rejected';
    }
    const canonical = active?.latest ?? dependencies.getCanonicalAdjustments();
    if (!canonical) return 'rejected';
    const before = canonical;
    // Adjustment recipes are immutable by contract. Preserving unchanged
    // references lets the delta projector skip unrelated modules at pointer rate.
    const next = mutate(before);
    if (!active && adjustmentsEqual(before, next)) return 'unchanged';
    const targetLayerId = active?.targetLayerId ?? dependencies.getActiveTargetLayerId();
    const documentId = dependencies.getDocumentId();
    if (!documentId) return 'rejected';

    if (targetLayerId) {
      const applyToDocument = (document: ImageDocument) => {
        const projection = projectAdjustmentDelta({
          previousSnapshot: before,
          snapshot: next,
          targetLayerId,
          document,
          documentAdjustments: dependencies.getDocumentAdjustments()
        });
        return projection.document ?? document;
      };
      const changed = active?.documentTransaction
        ? active.documentTransaction.change(applyToDocument)
        : dependencies.documentMutations.change(applyToDocument, true, {
          label: 'Edit Adjustment Layer',
          type: 'adjustment.layer.edit',
          layerIds: [targetLayerId]
        });
      if (!changed) return adjustmentsEqual(before, next) ? 'unchanged' : 'rejected';
      dependencies.stageEditorAdjustments(next);
    } else if (active) {
      dependencies.previewDocumentProcessing(next, domain);
    } else {
      const previous = cloneAdjustments(before);
      dependencies.commitDocumentProcessing(next, domain);
      try {
        const synthetic: ActiveAdjustmentTransaction = {
          token: { sequence: 0 },
          documentId,
          targetLayerId: null,
          targetIdentity: dependencies.getActiveTargetIdentity(),
          before: previous,
          latest: cloneAdjustments(next),
          domain,
          documentTransaction: null,
          renderer: dependencies.getRenderer()!,
          rendererGeneration: dependencies.getRendererGeneration()
        };
        pushDocumentProcessingHistory(synthetic, next);
      } catch (error) {
        dependencies.commitDocumentProcessing(previous, domain);
        throw error;
      }
    }

    if (active) {
      active.latest = next;
      active.domain = domain;
    } else {
      dependencies.onCommitted?.({
        before: cloneAdjustments(before), after: cloneAdjustments(next),
        targetLayerId, domain
      });
    }
    return 'applied';
  };

  return {
    get active() { return active !== null; },
    begin,
    end: (token) => {
      if (active?.token !== token) {
        if (rejectedGesture && rejectedToken === token) {
          rejectedGesture = false;
          rejectedToken = null;
        }
        return 'rejected';
      }
      return endActive();
    },
    cancel: (token) => {
      if (active?.token !== token) {
        if (rejectedGesture && rejectedToken === token) {
          rejectedGesture = false;
          rejectedToken = null;
        }
        return;
      }
      cancelActive();
    },
    reset: cancelActive,
    changeResult,
    change: (...args) => changeResult(...args) === 'applied'
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
  useEffect(() => () => controller.reset(), [controller]);
  return controller;
};
