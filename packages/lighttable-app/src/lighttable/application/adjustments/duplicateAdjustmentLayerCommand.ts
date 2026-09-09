import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import type { ReversiblePixelEdit } from '../../editor/history/ReversiblePixelEdit';
import { commitAppliedPixelMutation, type PixelMutationTransactionDependencies } from '../commands/pixelMutationTransaction';
import type { DocumentMutationTransaction } from '../documents/useDocumentMutationController';

export interface AdjustmentLayerDuplicateRenderer {
  beginLayerPixelEdit(layerId: LayerId, channel: 'mask'): void;
  captureAllPixelEdit(layerId: LayerId, channel: 'mask'): number;
  copyLayerMask(sourceId: LayerId, destinationId: LayerId): boolean;
  finishPixelEdit(): ReversiblePixelEdit | null;
  cancelPixelEdit(): void;
}

interface CommitAdjustmentLayerDuplicateOptions {
  readonly transaction: DocumentMutationTransaction;
  readonly next: ImageDocument;
  readonly sourceId: LayerId;
  readonly destinationId: LayerId;
  readonly renderer: AdjustmentLayerDuplicateRenderer;
  readonly resolveDependencies: () => PixelMutationTransactionDependencies;
}

/**
 * Publishes a duplicated Adjustment Layer and retains its document-sized mask
 * through the shared reversible GPU-history owner.
 */
export const commitAdjustmentLayerDuplicate = ({
  transaction,
  next,
  sourceId,
  destinationId,
  renderer,
  resolveDependencies
}: CommitAdjustmentLayerDuplicateOptions): boolean => {
  if (!transaction.stage(() => next)) {
    transaction.cancel();
    return false;
  }
  return transaction.commitWith((before, after) => {
    let editOpen = false;
    let pixelEdit: ReversiblePixelEdit | null = null;
    try {
      // Publishing the staged node allocates its document-owned mask target.
      resolveDependencies().applyDocumentSnapshot(after);
      renderer.beginLayerPixelEdit(destinationId, 'mask');
      editOpen = true;
      if (renderer.captureAllPixelEdit(destinationId, 'mask') < 1) {
        throw new Error('The duplicated mask could not capture its undo state.');
      }
      if (!renderer.copyLayerMask(sourceId, destinationId)) {
        throw new Error('The layer mask could not be duplicated on the GPU.');
      }
      pixelEdit = renderer.finishPixelEdit();
      editOpen = false;
      if (!pixelEdit) throw new Error('The duplicated mask has no reversible history state.');
    } catch (reason) {
      if (editOpen) renderer.cancelPixelEdit();
      try {
        pixelEdit?.undo();
      } finally {
        pixelEdit?.destroy();
      }
      resolveDependencies().applyDocumentSnapshot(before);
      throw reason;
    }

    const completedEdit = pixelEdit;
    commitAppliedPixelMutation(resolveDependencies, {
      operation: 'Duplicate Layer',
      label: 'Duplicate Layer',
      type: 'layer.duplicate',
      layerIds: [sourceId, destinationId],
      before,
      undoBase: after,
      redoBase: after,
      after,
      edits: [completedEdit]
    });
    return true;
  });
};
