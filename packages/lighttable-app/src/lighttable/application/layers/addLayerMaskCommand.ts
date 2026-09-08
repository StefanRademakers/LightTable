import { addLayerMask, markLayerMaskPixelsChanged } from '../../editor/document/documentCommands';
import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import type { ReversiblePixelEdit } from '../../editor/history/ReversiblePixelEdit';
import { commitAppliedPixelMutation, type PixelMutationHistoryEntry } from '../commands/pixelMutationTransaction';
import type { DocumentMutationTransaction } from '../documents/useDocumentMutationController';

interface AddMaskRendererPort {
  beginLayerPixelEdit(layerId: LayerId, channel: 'mask'): void;
  bakeSelectionIntoLayerMask(layerId: LayerId): boolean;
  finishPixelEdit(): ReversiblePixelEdit | null;
  cancelPixelEdit(): void;
  applyPixelHistory(edit: ReversiblePixelEdit, direction: 'undo' | 'redo'): boolean;
}

interface AddMaskDependencies {
  getDocument(): ImageDocument | null;
  getRenderer(): AddMaskRendererPort | null;
  applyDocumentSnapshot(document: ImageDocument): void;
  pushHistoryEntry(entry: PixelMutationHistoryEntry): void;
  setActiveChannel(channel: 'mask'): void;
  setStatus(message: string): void;
  setError(message: string | null): void;
}

type BeginAddMaskTransaction = (
  key: string,
  description: { readonly label: string; readonly type: string }
) => DocumentMutationTransaction | null;

export const createAddLayerMaskCommand = (
  resolveDependencies: () => AddMaskDependencies,
  beginTransaction: BeginAddMaskTransaction
) => {
  const add = (layerId: LayerId, useSelection: boolean, present = false): boolean => {
    const dependencies = resolveDependencies();
    const description = { label: 'Add Layer Mask', type: 'layer.mask.add' } as const;
    const transaction = beginTransaction(`layer.mask.add:${layerId}`, description);
    if (!transaction) return false;
    const before = transaction.before;
    const layer = findDocumentLayer(before, layerId);
    if (!layer || layer.mask) {
      transaction.cancel();
      return false;
    }
    const withMask = addLayerMask(before, layerId);
    if (withMask === before) {
      transaction.cancel();
      return false;
    }

    if (!useSelection) {
      try {
        if (!transaction.stage(() => withMask) || !transaction.commit(description)) return false;
      } catch (reason) {
        transaction.cancel();
        if (present) dependencies.setError(
          reason instanceof Error ? reason.message : 'The layer mask could not be added.'
        );
        return false;
      }
      if (present) {
        dependencies.setActiveChannel('mask');
        dependencies.setError(null);
        dependencies.setStatus(`Added layer mask to ${layer.name}`);
      }
      return true;
    }

    const renderer = dependencies.getRenderer();
    if (!renderer) {
      transaction.cancel();
      if (present) dependencies.setError('The current selection could not be baked into a layer mask.');
      return false;
    }
    let editOpen = false;
    let pixelEdit: ReversiblePixelEdit | null = null;
    try {
      if (!transaction.change(() => withMask)) {
        throw new Error('The layer mask preview could not be prepared.');
      }
      renderer.beginLayerPixelEdit(layerId, 'mask');
      editOpen = true;
      if (!renderer.bakeSelectionIntoLayerMask(layerId)) {
        throw new Error('The current selection could not be copied into the layer mask.');
      }
      pixelEdit = renderer.finishPixelEdit();
      editOpen = false;
      if (!pixelEdit) throw new Error('The layer mask could not create a recoverable undo step.');
      const after = markLayerMaskPixelsChanged(withMask, layerId, {
        x: 0, y: 0, width: before.width, height: before.height
      });
      if (!transaction.stage(() => after)) {
        throw new Error('The layer mask transaction could not be staged.');
      }
      const completedEdit = pixelEdit;
      if (!transaction.commitWith((ownedBefore, ownedAfter) => {
        pixelEdit = null;
        commitAppliedPixelMutation(resolveDependencies, {
          operation: description.label,
          label: description.label,
          type: description.type,
          layerIds: [layerId],
          before: ownedBefore,
          redoBase: withMask,
          after: ownedAfter,
          edits: [completedEdit]
        });
        return true;
      })) throw new Error('The layer mask transaction could not be committed.');
      if (present) {
        dependencies.setActiveChannel('mask');
        dependencies.setError(null);
        dependencies.setStatus(`Added selection as a mask to ${layer.name}`);
      }
      return true;
    } catch (reason) {
      if (editOpen) renderer.cancelPixelEdit();
      if (pixelEdit) {
        try { pixelEdit.undo(); } finally { pixelEdit.destroy(); }
      }
      transaction.cancel();
      if (present) dependencies.setError(
        reason instanceof Error ? reason.message : 'The current selection could not be baked into a layer mask.'
      );
      return false;
    }
  };

  return {
    add,
    addActive: (useSelection: boolean) => {
      const layerId = resolveDependencies().getDocument()?.activeLayerId;
      return layerId ? add(layerId, useSelection, true) : false;
    }
  };
};
