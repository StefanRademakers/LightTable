import type { ImageDocument, LayerId } from '../../../editor/document/documentTypes';
import { findDocumentLayer } from '../../../editor/document/layerTree';
import type { ReversiblePixelEdit } from '../../../editor/history/ReversiblePixelEdit';
import type { SelectionMaskSnapshot } from '../../../editor/selection/SelectionMaskSnapshot';
import type { SelectionOperation } from '../../../editor/selection/selectionTypes';
import type { AffineMatrix } from '../../../editor/tools/transform/transformTypes';
import type { DocumentMutationTransaction } from '../../documents/useDocumentMutationController';
import { AsyncPixelStateRollbackOwner } from '../../commands/AsyncPixelStateRollbackOwner';
import { AsyncPixelStateTransitionOwner } from '../../commands/AsyncPixelStateTransitionOwner';
import {
  commitAppliedPixelMutation,
  UnpublishedPixelRollbackOwner
} from '../../commands/pixelMutationTransaction';
import type { FinishTransformResult } from './transformController';

export interface TransformPublicationRenderer {
  applyPixelHistory(edit: ReversiblePixelEdit, direction: 'undo' | 'redo'): boolean;
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
  expectedSelectionRevision: number;
  expectedSelectionMask: SelectionMaskSnapshot;
}

export interface TransformPublicationDependencies {
  getDocument(): ImageDocument | null;
  getRenderer(): TransformPublicationRenderer | null;
  getRendererGeneration(): number;
  getSelection(): SelectionOperation[];
  getSelectionRevision(): number;
  getSelectionMaskSnapshot(): SelectionMaskSnapshot | null;
  applyDocumentSnapshot(document: ImageDocument): void;
  applyDocumentAndSelection(
    document: ImageDocument,
    selection: SelectionOperation[],
    selectionMaskSnapshot: SelectionMaskSnapshot,
    binding: TransformSelectionPublicationBinding
  ): Promise<void>;
  pushHistoryEntry(entry: TransformPublicationHistoryEntry): void;
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
  openingSelection: SelectionOperation[] | null;
  openingSelectionRevision: number | null;
  openingSelectionMask: SelectionMaskSnapshot | null;
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

  constructor(private readonly dependencies: () => TransformPublicationDependencies) {}

  async recover(): Promise<boolean> {
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
      if (result.kind !== 'layer' && renderer) {
        if (this.rendererIsCurrent(renderer, request.rendererGeneration)) {
          this.unpublishedRollback.rollback(
            (edit, direction) => renderer.applyPixelHistory(edit, direction),
            [result.pixelEdit]
          );
        } else result.pixelEdit.destroy();
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
        if (layer) current.onLayerTransformCommitted?.(layer.id, { ...layer.transform });
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
    let editOwned = true;
    const rollback = () => {
      if (!editOwned || !renderer) return;
      if (!this.rendererIsCurrent(renderer, rendererGeneration)) {
        result.pixelEdit.destroy();
        editOwned = false;
        return;
      }
      const outcome = this.unpublishedRollback.rollback(
        (edit, direction) => this.applyOpeningPixel(
          renderer, rendererGeneration, edit, direction
        ),
        [result.pixelEdit]
      );
      if (outcome.ok) editOwned = false;
    };
    if (!transaction.stage(() => result.afterDocument)) {
      rollback();
      return;
    }
    try {
      const committed = transaction.commitWith((before, after) => {
        editOwned = false;
        commitAppliedPixelMutation(() => ({
          getRenderer: () => renderer && this.rendererIsCurrent(renderer, rendererGeneration)
            ? renderer
            : null,
          applyDocumentSnapshot: (document) => this.dependencies().applyDocumentSnapshot(document),
          pushHistoryEntry: (entry) => this.dependencies().pushHistoryEntry(entry)
        }), {
          operation: 'Free Transform', label: 'Free Transform', type: 'transform.layer',
          layerIds: [result.layerId], before, after, edits: [result.pixelEdit]
        });
        return true;
      });
      if (!committed) rollback();
      else this.dependencies().onRasterTransformCommitted?.(result.layerId, 'layer');
    } catch (reason) {
      rollback();
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
    if (!renderer || !beforeSelectionMask) {
      if (renderer) this.unpublishedRollback.rollback(
        (edit, direction) => this.applyOpeningPixel(
          renderer, request.rendererGeneration, edit, direction
        ), [result.pixelEdit]
      );
      transaction.cancel();
      current.setError('The exact selection state was unavailable; the transform was rolled back.');
      return;
    }
    let editOwned = true;
    const rollback = () => {
      if (!editOwned) return;
      if (!this.rendererIsCurrent(renderer, request.rendererGeneration)) {
        result.pixelEdit.destroy();
        editOwned = false;
        return;
      }
      const outcome = this.unpublishedRollback.rollback(
        (edit, direction) => this.applyOpeningPixel(
          renderer, request.rendererGeneration, edit, direction
        ), [result.pixelEdit]
      );
      if (outcome.ok) editOwned = false;
    };
    if (!transaction.stage(() => result.afterDocument)) {
      rollback();
      return;
    }
    try {
      const committed = await transaction.commitWithAsync(async (before, after) => {
        let afterMask: SelectionMaskSnapshot;
        try {
          afterMask = await renderer.captureSelectionSnapshot();
        } catch (reason) {
          current.setError(reason instanceof Error
            ? `The transformed selection could not be captured: ${reason.message}`
            : 'The transformed selection could not be captured; the transform was rolled back.');
          rollback();
          return false;
        }
        const latest = this.dependencies();
        if (latest.getRenderer() !== renderer
          || latest.getRendererGeneration() !== request.rendererGeneration
          || latest.getDocument() !== before
          || latest.getSelectionRevision() !== request.openingSelectionRevision
          || latest.getSelection() !== request.openingSelection
          || latest.getSelectionMaskSnapshot() !== request.openingSelectionMask) {
          rollback();
          latest.setError('The document changed while the transform was finishing; the transform was rolled back.');
          return false;
        }
        try {
          if (request.rendererGeneration === null || request.openingSelectionRevision === null) {
            throw new Error('The transform selection lease was unavailable.');
          }
          await latest.applyDocumentAndSelection(after, result.afterSelection, afterMask, {
            renderer,
            rendererGeneration: request.rendererGeneration,
            expectedDocument: before,
            expectedSelectionRevision: request.openingSelectionRevision,
            expectedSelectionMask: beforeSelectionMask
          });
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
            if (opening.getDocument() !== sourceDocument
              || opening.getSelectionMaskSnapshot() !== sourceMask) {
              throw new Error(`Transform ${targetPixels} source state is no longer current.`);
            }
            const outcome = await owner.transition({
              identity,
              applyTarget: () => {
                const dependencies = this.dependencies();
                return this.applyOpeningPixel(
                  renderer, request.rendererGeneration, result.pixelEdit, targetPixels
                );
              },
              applySource: () => {
                return this.applyOpeningPixel(
                  renderer,
                  request.rendererGeneration,
                  result.pixelEdit,
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
          latest.pushHistoryEntry({
            label: 'Free Transform', type: 'transform.selection',
            byteSize: result.pixelEdit.byteSize + beforeSelectionMask.byteSize + afterMask.byteSize,
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
            dispose: result.pixelEdit.destroy
          });
          editOwned = false;
          latest.onRasterTransformCommitted?.(result.layerId, 'selection');
          return true;
        } catch (reason) {
          if (!this.rendererIsCurrent(renderer, request.rendererGeneration)) {
            result.pixelEdit.destroy();
            editOwned = false;
            throw reason;
          }
          const recovery = await this.selectionRollback.rollback({
            edit: result.pixelEdit,
            applyPixel: (direction) => this.applyOpeningPixel(
              renderer, request.rendererGeneration, result.pixelEdit, direction
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
      if (!committed) rollback();
    } catch (reason) {
      rollback();
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
    if (!this.rendererIsCurrent(renderer, rendererGeneration)
      || current.getDocument() !== expectedDocument
      || current.getSelectionMaskSnapshot() !== expectedMask) {
      throw new Error('The transform state binding is no longer current.');
    }
    await current.applyDocumentAndSelection(targetDocument, targetSelection, targetMask, {
      renderer,
      rendererGeneration,
      expectedDocument,
      expectedSelectionRevision: current.getSelectionRevision(),
      expectedSelectionMask: expectedMask
    });
  }
}
