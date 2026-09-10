import type { ImageDocument, LayerId } from '../../../editor/document/documentTypes';
import { findDocumentLayer } from '../../../editor/document/layerTree';
import type { ReversiblePixelEdit } from '../../../editor/history/ReversiblePixelEdit';
import type { SelectionMaskSnapshot } from '../../../editor/selection/SelectionMaskSnapshot';
import type { SelectionOperation } from '../../../editor/selection/selectionTypes';
import type { LightTableSelectionReadLease } from '../selection/DocumentSelectionStateStore';
import type { AffineMatrix } from '../../../editor/tools/transform/transformTypes';
import type { DocumentMutationTransaction } from '../../documents/useDocumentMutationController';
import { AsyncPixelStateRollbackOwner } from '../../commands/AsyncPixelStateRollbackOwner';
import { AsyncPixelStateTransitionOwner } from '../../commands/AsyncPixelStateTransitionOwner';
import {
  reserveAppliedPixelMutation,
  UnpublishedPixelRollbackOwner
} from '../../commands/pixelMutationTransaction';
import type { DocumentHistoryReservation } from '../../commands/documentCommandHistory';
import type { FinishTransformResult } from './transformController';
import { TransformSelectionPublicationError } from './publishTransformDocumentSelection';

export interface TransformPublicationRenderer {
  applyPixelHistory(edit: ReversiblePixelEdit, direction: 'undo' | 'redo'): boolean;
  commitLayerTransform(): ReversiblePixelEdit | null;
  cancelLayerTransform(): boolean | void;
  captureSelectionSnapshot(): Promise<SelectionMaskSnapshot>;
  restoreSelectionSnapshot(snapshot: SelectionMaskSnapshot): Promise<boolean>;
}

export interface TransformPublicationHistoryEntry {
  label: string;
  type: string;
  byteSize: number;
  layerIds: readonly LayerId[];
  undo(): void | Promise<void>;
  redo(): void | Promise<void>;
  dispose(): void;
}

export interface TransformSelectionPublicationBinding {
  renderer: TransformPublicationRenderer;
  rendererGeneration: number;
  expectedDocument: ImageDocument;
  expectedSelectionLease: LightTableSelectionReadLease;
}

export interface TransformPublicationDependencies {
  getDocument(): ImageDocument | null;
  getRenderer(): TransformPublicationRenderer | null;
  getRendererGeneration(): number;
  getSelectionLease(): LightTableSelectionReadLease | null;
  applyDocumentSnapshot(document: ImageDocument): void;
  applyDocumentAndSelection(
    document: ImageDocument,
    selection: SelectionOperation[],
    selectionMaskSnapshot: SelectionMaskSnapshot,
    binding: TransformSelectionPublicationBinding
  ): Promise<void>;
  reserveHistoryEntry(entry: TransformPublicationHistoryEntry): DocumentHistoryReservation;
  setError(message: string | null): void;
  onLayerTransformCommitted?(layerId: LayerId, transform: AffineMatrix): void;
  onRasterTransformCommitted?(layerId: LayerId, kind: 'layer' | 'selection'): void;
}

export interface TransformPublicationRequest {
  result: FinishTransformResult;
  beforeSelectionMask: SelectionMaskSnapshot | null;
  transaction: DocumentMutationTransaction | null;
  renderer: TransformPublicationRenderer | null;
  rendererGeneration: number | null;
  openingSelectionLease: LightTableSelectionReadLease | null;
}

/**
 * Sole terminal owner for a finished single-layer transform.
 *
 * It keeps renderer pixel swaps, canonical document/selection publication and
 * history transfer on the same side of the transaction. Failed compensation
 * retains its exact snapshots and blocks the next transform until retry works.
 */
export class TransformPublicationOwner {
  readonly unpublishedRollback = new UnpublishedPixelRollbackOwner();
  readonly selectionRollback = new AsyncPixelStateRollbackOwner();
  private indeterminatePixelEdit: {
    readonly edit: ReversiblePixelEdit;
    readonly documentSessionId: LightTableSelectionReadLease['document']['sessionId'];
    readonly renderer: TransformPublicationRenderer;
    readonly rendererGeneration: number;
  } | null = null;

  constructor(private readonly dependencies: () => TransformPublicationDependencies) {}

  retireStaleScope(): void {
    const quarantine = this.indeterminatePixelEdit;
    if (!quarantine) return;
    const current = this.dependencies();
    const currentLease = current.getSelectionLease();
    if (current.getRenderer() === quarantine.renderer
      && current.getRendererGeneration() === quarantine.rendererGeneration
      && currentLease?.document.sessionId === quarantine.documentSessionId) return;
    quarantine.edit.destroy();
    this.indeterminatePixelEdit = null;
  }

  dispose(): void {
    this.indeterminatePixelEdit?.edit.destroy();
    this.indeterminatePixelEdit = null;
  }

  async recover(): Promise<boolean> {
    this.retireStaleScope();
    if (this.indeterminatePixelEdit) return false;
    const selection = await this.selectionRollback.retry();
    if (selection && !selection.ok) return false;
    const pixels = this.unpublishedRollback.retry();
    return !pixels || pixels.ok;
  }

  async apply(request: TransformPublicationRequest): Promise<void> {
    const { result, beforeSelectionMask, transaction, renderer } = request;
    if (result.kind === 'cancelled' || result.kind === 'unchanged') {
      transaction?.cancel();
      return;
    }
    const current = this.dependencies();
    if (result.kind === 'error') {
      transaction?.cancel();
      current.setError(result.message);
      return;
    }
    if (!transaction) {
      if (result.kind !== 'layer' && renderer
        && this.rendererIsCurrent(renderer, request.rendererGeneration)) {
        renderer.cancelLayerTransform();
      }
      current.setError('The transform no longer owns the active document transaction.');
      return;
    }
    if (result.kind === 'layer') {
      if (result.afterDocument === result.beforeDocument) {
        transaction.cancel();
        return;
      }
      if (!transaction.stage(() => result.afterDocument)) return;
      if (transaction.commit()) {
        const layer = findDocumentLayer(result.afterDocument, result.layerId);
        if (layer) {
          try {
            current.onLayerTransformCommitted?.(layer.id, { ...layer.transform });
          } catch {
            current.setError(
              'The transform was committed, but its document change notification failed.'
            );
          }
        }
      }
      return;
    }
    if (result.kind === 'raster-layer') {
      await this.applyRasterLayer(result, transaction, renderer, request.rendererGeneration);
      return;
    }
    await this.applySelection(result, beforeSelectionMask, transaction, renderer, request);
  }

  private async applyRasterLayer(
    result: Extract<FinishTransformResult, { kind: 'raster-layer' }>,
    transaction: DocumentMutationTransaction,
    renderer: TransformPublicationRenderer | null,
    rendererGeneration: number | null
  ) {
    const cancelPreview = () => {
      if (renderer && this.rendererIsCurrent(renderer, rendererGeneration)) {
        renderer.cancelLayerTransform();
      }
    };
    if (!transaction.stage(() => result.afterDocument)) {
      cancelPreview();
      return;
    }
    try {
      const committed = transaction.commitWith((before, after) => {
        if (!renderer || !this.rendererIsCurrent(renderer, rendererGeneration)) {
          throw new Error('The opening transform renderer is unavailable.');
        }
        const publication = reserveAppliedPixelMutation(() => ({
          getRenderer: () => renderer && this.rendererIsCurrent(renderer, rendererGeneration)
            ? renderer
            : null,
          applyDocumentSnapshot: (document) => this.dependencies().applyDocumentSnapshot(document),
          reserveHistoryEntry: (entry) => this.dependencies().reserveHistoryEntry(entry)
        }), { label: 'Free Transform', type: 'transform.layer', layerIds: [result.layerId] });
        const pixelEdit = renderer.commitLayerTransform();
        if (!pixelEdit) {
          publication.cancel();
          renderer.cancelLayerTransform();
          throw new Error('The transform could not be committed.');
        }
        publication.commit({
          operation: 'Free Transform', label: 'Free Transform', type: 'transform.layer',
          layerIds: [result.layerId], before, after, edits: [pixelEdit]
        });
        return true;
      });
      if (!committed) cancelPreview();
      else {
        try {
          this.dependencies().onRasterTransformCommitted?.(result.layerId, 'layer');
        } catch {
          this.dependencies().setError(
            'The transform was committed, but its document change notification failed.'
          );
        }
      }
    } catch (reason) {
      cancelPreview();
      throw reason;
    }
  }

  private async applySelection(
    result: Extract<FinishTransformResult, { kind: 'selection' }>,
    beforeSelectionMask: SelectionMaskSnapshot | null,
    transaction: DocumentMutationTransaction,
    renderer: TransformPublicationRenderer | null,
    request: TransformPublicationRequest
  ) {
    const current = this.dependencies();
    const openingSelectionLease = request.openingSelectionLease;
    if (!renderer || !beforeSelectionMask || !openingSelectionLease
      || request.rendererGeneration === null) {
      if (renderer && this.rendererIsCurrent(renderer, request.rendererGeneration)) {
        renderer.cancelLayerTransform();
      }
      transaction.cancel();
      current.setError('The exact selection state was unavailable; the transform was rolled back.');
      return;
    }
    if (!transaction.stage(() => result.afterDocument)) {
      if (this.rendererIsCurrent(renderer, request.rendererGeneration)) {
        renderer.cancelLayerTransform();
      }
      return;
    }

    let pixelEdit: ReversiblePixelEdit | null = null;
    let editOwned = false;
    let canonicalAfterPublished = false;
    let historyDelegate: TransformPublicationHistoryEntry | null = null;
    let historyReservation: DocumentHistoryReservation | null = null;
    const historyProxy: TransformPublicationHistoryEntry = {
      label: 'Free Transform',
      type: 'transform.selection',
      byteSize: 0,
      layerIds: [result.layerId],
      undo: () => {
        if (!historyDelegate) throw new Error('Free Transform history was not finalized.');
        return historyDelegate.undo();
      },
      redo: () => {
        if (!historyDelegate) throw new Error('Free Transform history was not finalized.');
        return historyDelegate.redo();
      },
      dispose: () => historyDelegate?.dispose()
    };
    const discardPreview = () => {
      if (!pixelEdit && this.rendererIsCurrent(renderer, request.rendererGeneration)) {
        renderer.cancelLayerTransform();
      }
    };
    const cancelHistoryReservation = () => {
      const reservation: DocumentHistoryReservation | null = historyReservation;
      reservation?.cancel();
      historyReservation = null;
    };
    const rollbackUnpublishedPixels = () => {
      if (!pixelEdit || !editOwned) return;
      if (!this.rendererIsCurrent(renderer, request.rendererGeneration)) {
        pixelEdit.destroy();
        editOwned = false;
        return;
      }
      const outcome = this.unpublishedRollback.rollback(
        (edit, direction) => this.applyOpeningPixel(
          renderer, request.rendererGeneration, edit, direction
        ), [pixelEdit]
      );
      editOwned = false;
      if (!outcome.ok) {
        this.dependencies().setError(outcome.compensationFailed
          ? 'Transform pixel rollback failed and is quarantined.'
          : 'Transform pixel rollback must be retried before another transform.');
      }
    };

    try {
      const committed = await transaction.commitWithAsync(async (before, after) => {
        const opening = this.dependencies();
        if (!this.rendererIsCurrent(renderer, request.rendererGeneration)
          || opening.getDocument() !== before
          || !this.sameSelectionLease(opening.getSelectionLease(), openingSelectionLease)) {
          discardPreview();
          opening.setError('The document changed while the transform was finishing; the transform was rolled back.');
          return false;
        }

        historyReservation = opening.reserveHistoryEntry(historyProxy);
        pixelEdit = renderer.commitLayerTransform();
        if (!pixelEdit) {
          historyReservation.cancel();
          historyReservation = null;
          renderer.cancelLayerTransform();
          throw new Error('The transform could not be committed.');
        }
        editOwned = true;

        let afterMask: SelectionMaskSnapshot;
        try {
          afterMask = await renderer.captureSelectionSnapshot();
        } catch (reason) {
          this.dependencies().setError(reason instanceof Error
            ? `The transformed selection could not be captured: ${reason.message}`
            : 'The transformed selection could not be captured; the transform was rolled back.');
          throw reason;
        }
        const latest = this.dependencies();
        const currentLease = latest.getSelectionLease();
        if (latest.getRenderer() !== renderer
          || latest.getRendererGeneration() !== request.rendererGeneration
          || latest.getDocument() !== before
          || !this.sameSelectionLease(currentLease, openingSelectionLease)) {
          latest.setError('The document changed while the transform was finishing; the transform was rolled back.');
          throw new Error('The transform publication lease is no longer current.');
        }
        try {
          await latest.applyDocumentAndSelection(after, result.afterSelection, afterMask, {
            renderer,
            rendererGeneration: request.rendererGeneration,
            expectedDocument: before,
            expectedSelectionLease: openingSelectionLease
          });
          canonicalAfterPublished = true;
          const undoTransition = new AsyncPixelStateTransitionOwner();
          const redoTransition = new AsyncPixelStateTransitionOwner();
          const undoIdentity = {};
          const redoIdentity = {};
          const transition = async (
            owner: AsyncPixelStateTransitionOwner,
            identity: object,
            targetPixels: 'undo' | 'redo',
            sourceDocument: ImageDocument,
            sourceSelection: SelectionOperation[],
            sourceMask: SelectionMaskSnapshot,
            targetDocument: ImageDocument,
            targetSelection: SelectionOperation[],
            targetMask: SelectionMaskSnapshot
          ) => {
            const opening = this.dependencies();
            const openingLease = opening.getSelectionLease();
            if (opening.getDocument() !== sourceDocument
              || openingLease?.selection.coverage !== sourceMask) {
              throw new Error(`Transform ${targetPixels} source state is no longer current.`);
            }
            const outcome = await owner.transition({
              identity,
              applyTarget: () => {
                const dependencies = this.dependencies();
                return this.applyOpeningPixel(
                  renderer, request.rendererGeneration, pixelEdit!, targetPixels
                );
              },
              applySource: () => {
                return this.applyOpeningPixel(
                  renderer,
                  request.rendererGeneration,
                  pixelEdit!,
                  targetPixels === 'undo' ? 'redo' : 'undo'
                );
              },
              restoreSource: () => this.applyBoundState(
                renderer, request.rendererGeneration!,
                sourceDocument, sourceMask,
                sourceDocument, sourceSelection, sourceMask
              ),
              restoreTarget: () => this.applyBoundState(
                renderer, request.rendererGeneration!,
                sourceDocument, sourceMask,
                targetDocument, targetSelection, targetMask
              )
            });
            if (!outcome.ok) throw outcome.reason instanceof Error
              ? outcome.reason
              : new Error(`Transform ${targetPixels} could not complete atomically.`);
          };
          historyDelegate = {
            label: 'Free Transform', type: 'transform.selection',
            byteSize: pixelEdit.byteSize + beforeSelectionMask.byteSize + afterMask.byteSize,
            layerIds: [result.layerId],
            undo: () => transition(
              undoTransition, undoIdentity, 'undo',
              after, result.afterSelection, afterMask,
              before, result.beforeSelection, beforeSelectionMask
            ),
            redo: () => transition(
              redoTransition, redoIdentity, 'redo',
              before, result.beforeSelection, beforeSelectionMask,
              after, result.afterSelection, afterMask
            ),
            dispose: pixelEdit.destroy
          };
          historyProxy.byteSize = historyDelegate.byteSize;
          if (!historyReservation?.commit()) {
            throw new Error('The Free Transform history reservation is no longer current.');
          }
          historyReservation = null;
          editOwned = false;
          return true;
        } catch (reason) {
          historyReservation?.cancel();
          historyReservation = null;
          if (reason instanceof TransformSelectionPublicationError
            && reason.phase === 'indeterminate') {
            this.indeterminatePixelEdit = {
              edit: pixelEdit,
              documentSessionId: openingSelectionLease.document.sessionId,
              renderer,
              rendererGeneration: request.rendererGeneration
            };
            editOwned = false;
            latest.setError(
              'Transform publication state is indeterminate; transforms are quarantined until document reload.'
            );
            throw reason;
          }
          if (!canonicalAfterPublished) {
            // Bound selection publication guarantees that a rejected publish
            // restores its renderer mask and canonical document/selection to
            // the opening side. Only the terminal pixel edit exists here.
            rollbackUnpublishedPixels();
            throw reason;
          }
          if (!this.rendererIsCurrent(renderer, request.rendererGeneration)) {
            pixelEdit.destroy();
            editOwned = false;
            throw reason;
          }
          const recovery = await this.selectionRollback.rollback({
            edit: pixelEdit,
            applyPixel: (direction) => this.applyOpeningPixel(
              renderer, request.rendererGeneration, pixelEdit!, direction
            ),
            restoreBefore: () => this.applyBoundState(
              renderer, request.rendererGeneration!,
              after, afterMask,
              before, result.beforeSelection, beforeSelectionMask
            ),
            restoreAfter: () => this.applyBoundState(
              renderer, request.rendererGeneration!,
              after, afterMask,
              after, result.afterSelection, afterMask
            )
          });
          editOwned = false;
          if (!recovery.ok) latest.setError(recovery.compensationFailed
            ? 'Transform publication and recovery both failed; transforms are quarantined.'
            : 'Transform publication failed; retrying the exact rollback is required.');
          throw reason;
        }
      });
      if (!committed) {
        cancelHistoryReservation();
        if (pixelEdit) rollbackUnpublishedPixels();
        else discardPreview();
      } else {
        try {
          this.dependencies().onRasterTransformCommitted?.(result.layerId, 'selection');
        } catch {
          this.dependencies().setError(
            'The transform was committed, but its document change notification failed.'
          );
        }
      }
    } catch (reason) {
      cancelHistoryReservation();
      if (pixelEdit) rollbackUnpublishedPixels();
      else discardPreview();
      throw reason;
    }
  }

  private rendererIsCurrent(
    renderer: TransformPublicationRenderer,
    generation: number | null
  ): boolean {
    const current = this.dependencies();
    return generation !== null
      && current.getRenderer() === renderer
      && current.getRendererGeneration() === generation;
  }

  private applyOpeningPixel(
    renderer: TransformPublicationRenderer,
    generation: number | null,
    edit: ReversiblePixelEdit,
    direction: 'undo' | 'redo'
  ): boolean {
    return this.rendererIsCurrent(renderer, generation)
      && renderer.applyPixelHistory(edit, direction);
  }

  private async applyBoundState(
    renderer: TransformPublicationRenderer,
    rendererGeneration: number,
    expectedDocument: ImageDocument,
    expectedMask: SelectionMaskSnapshot,
    targetDocument: ImageDocument,
    targetSelection: SelectionOperation[],
    targetMask: SelectionMaskSnapshot
  ): Promise<void> {
    const current = this.dependencies();
    const currentLease = current.getSelectionLease();
    if (!this.rendererIsCurrent(renderer, rendererGeneration)
      || current.getDocument() !== expectedDocument
      || !currentLease
      || currentLease.selection.coverage !== expectedMask) {
      throw new Error('The transform state binding is no longer current.');
    }
    await current.applyDocumentAndSelection(targetDocument, targetSelection, targetMask, {
      renderer,
      rendererGeneration,
      expectedDocument,
      expectedSelectionLease: currentLease
    });
  }

  private sameSelectionLease(
    current: LightTableSelectionReadLease | null,
    expected: LightTableSelectionReadLease
  ): boolean {
    return Boolean(current
      && current.document.sessionId === expected.document.sessionId
      && current.document.revision === expected.document.revision
      && current.selection.revision === expected.selection.revision
      && current.selection.coverage === expected.selection.coverage);
  }
}
