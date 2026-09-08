import { removeLayerMask } from '../../editor/document/documentCommands';
import { layerIsLocked, type ImageDocument, type LayerId } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import type { ReversiblePixelEdit } from '../../editor/history/ReversiblePixelEdit';
import {
  commitAppliedPixelMutation,
  type PixelMutationHistoryEntry
} from '../commands/pixelMutationTransaction';
import type { DocumentMutationTransaction } from '../documents/useDocumentMutationController';

interface RemoveMaskRendererPort {
  beginLayerPixelEdit(layerId: LayerId, channel: 'mask'): void;
  captureAllPixelEdit(layerId: LayerId, channel: 'mask'): number;
  finishPixelEdit(): ReversiblePixelEdit | null;
  cancelPixelEdit(): void;
  applyPixelHistory(edit: ReversiblePixelEdit, direction: 'undo' | 'redo'): boolean;
}

interface RemoveMaskDependencies {
  getRenderer(): RemoveMaskRendererPort | null;
  applyDocumentSnapshot(document: ImageDocument): void;
  pushHistoryEntry(entry: PixelMutationHistoryEntry): void;
  setActiveChannel(channel: 'pixels'): void;
  setStatus(message: string): void;
  setError(message: string | null): void;
}

type BeginRemoveMaskTransaction = (
  key: string,
  description: { readonly label: string; readonly type: string }
) => DocumentMutationTransaction | null;

export const createRemoveLayerMaskCommand = (
  resolveDependencies: () => RemoveMaskDependencies,
  beginTransaction: BeginRemoveMaskTransaction
) => (layerId: LayerId, present = false): boolean => {
  const dependencies = resolveDependencies();
  const description = { label: 'Delete Layer Mask', type: 'layer.mask.remove' } as const;
  const transaction = beginTransaction(`layer.mask.remove:${layerId}`, description);
  if (!transaction) return false;
  const before = transaction.before;
  const layer = findDocumentLayer(before, layerId);
  const renderer = dependencies.getRenderer();
  if (!layer?.mask || !renderer || layerIsLocked(layer, 'pixels')) {
    transaction.cancel();
    if (present && layer && layerIsLocked(layer, 'pixels')) {
      dependencies.setError('Unlock the target layer before deleting its mask.');
    }
    return false;
  }
  const after = removeLayerMask(before, layerId);
  if (after === before || !transaction.stage(() => after)) {
    transaction.cancel();
    return false;
  }

  let editOpen = false;
  let pixelEdit: ReversiblePixelEdit | null = null;
  try {
    renderer.beginLayerPixelEdit(layerId, 'mask');
    editOpen = true;
    if (renderer.captureAllPixelEdit(layerId, 'mask') < 1) {
      throw new Error('The layer mask could not capture its recoverable pixels.');
    }
    pixelEdit = renderer.finishPixelEdit();
    editOpen = false;
    if (!pixelEdit) throw new Error('The layer mask could not create a recoverable undo step.');
    const completedEdit = pixelEdit;
    if (!transaction.commitWith((ownedBefore, ownedAfter) => {
      pixelEdit = null;
      commitAppliedPixelMutation(resolveDependencies, {
        operation: description.label,
        label: description.label,
        type: description.type,
        layerIds: [layerId],
        before: ownedBefore,
        undoBase: ownedBefore,
        after: ownedAfter,
        edits: [completedEdit]
      });
      return true;
    })) throw new Error('The layer mask deletion could not be committed.');
    dependencies.setActiveChannel('pixels');
    if (present) {
      dependencies.setError(null);
      dependencies.setStatus(`Deleted layer mask from ${layer.name}`);
    }
    return true;
  } catch (reason) {
    if (editOpen) renderer.cancelPixelEdit();
    pixelEdit?.destroy();
    transaction.cancel();
    if (present) dependencies.setError(
      reason instanceof Error ? reason.message : 'The layer mask could not be deleted.'
    );
    return false;
  }
};
