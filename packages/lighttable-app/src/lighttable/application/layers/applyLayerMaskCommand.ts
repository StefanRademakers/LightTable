import {
  markLayerPixelsChanged,
  removeLayerMask
} from '../../editor/document/documentCommands';
import { layerIsLocked, type ImageDocument, type LayerId } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import type { ReversiblePixelEdit } from '../../editor/history/ReversiblePixelEdit';
import {
  commitAppliedPixelMutation,
  type PixelMutationHistoryEntry
} from '../commands/pixelMutationTransaction';
import type { DocumentMutationTransaction } from '../documents/useDocumentMutationController';

interface ApplyMaskRendererPort {
  beginLayerPixelEdit(layerId: LayerId, channel: 'pixels' | 'mask'): void;
  captureAllPixelEdit(layerId: LayerId, channel: 'pixels' | 'mask'): number;
  applyLayerMaskToPixels(document: ImageDocument, layerId: LayerId): boolean;
  finishPixelEdit(): ReversiblePixelEdit | null;
  cancelPixelEdit(): void;
  applyPixelHistory(edit: ReversiblePixelEdit, direction: 'undo' | 'redo'): boolean;
}

interface ApplyMaskDependencies {
  getRenderer(): ApplyMaskRendererPort | null;
  applyDocumentSnapshot(document: ImageDocument): void;
  pushHistoryEntry(entry: PixelMutationHistoryEntry): void;
  setActiveChannel(channel: 'pixels'): void;
  setStatus(message: string): void;
  setError(message: string | null): void;
}

type BeginApplyMaskTransaction = (
  key: string,
  description: { readonly label: string; readonly type: string }
) => DocumentMutationTransaction | null;

const fullBounds = (document: ImageDocument) => ({
  x: 0, y: 0, width: document.width, height: document.height
});

export const createApplyLayerMaskCommand = (
  resolveDependencies: () => ApplyMaskDependencies,
  beginTransaction: BeginApplyMaskTransaction
) => (layerId: LayerId, present = false): boolean => {
  const dependencies = resolveDependencies();
  const description = { label: 'Apply Layer Mask', type: 'layer.mask.apply' } as const;
  const transaction = beginTransaction(`layer.mask.apply:${layerId}`, description);
  if (!transaction) return false;
  const before = transaction.before;
  const layer = findDocumentLayer(before, layerId);
  const renderer = dependencies.getRenderer();
  if (layer?.type !== 'raster' || !layer.mask || !renderer || layerIsLocked(layer, 'pixels')) {
    transaction.cancel();
    if (present) dependencies.setError(
      layer?.type !== 'raster'
        ? 'Apply Layer Mask currently requires a raster layer.'
        : 'Unlock the target layer before applying its mask.'
    );
    return false;
  }

  let editOpen = false;
  const edits: ReversiblePixelEdit[] = [];
  try {
    renderer.beginLayerPixelEdit(layerId, 'pixels');
    editOpen = true;
    if (renderer.captureAllPixelEdit(layerId, 'pixels') < 1
      || !renderer.applyLayerMaskToPixels(before, layerId)) {
      throw new Error('The layer mask could not be applied to its pixels.');
    }
    const pixelEdit = renderer.finishPixelEdit();
    editOpen = false;
    if (!pixelEdit) throw new Error('Apply Layer Mask could not capture pixel history.');
    edits.push(pixelEdit);

    // The document removes the mask target after commit. Retain an exact mask
    // snapshot as a second reversible step so undo can recreate its pixels.
    renderer.beginLayerPixelEdit(layerId, 'mask');
    editOpen = true;
    if (renderer.captureAllPixelEdit(layerId, 'mask') < 1) {
      throw new Error('Apply Layer Mask could not capture mask history.');
    }
    const maskEdit = renderer.finishPixelEdit();
    editOpen = false;
    if (!maskEdit) throw new Error('Apply Layer Mask could not retain the original mask.');
    edits.push(maskEdit);

    const after = removeLayerMask(markLayerPixelsChanged(before, layerId, fullBounds(before)), layerId);
    if (after === before || !transaction.stage(() => after)) {
      throw new Error('Apply Layer Mask could not stage its document result.');
    }
    const completed = [...edits];
    if (!transaction.commitWith((ownedBefore, ownedAfter) => {
      // commitWith may refuse the publication without invoking this callback.
      // Keep local rollback ownership until the transaction actually admits
      // the compound pixel/document publication.
      edits.length = 0;
      commitAppliedPixelMutation(resolveDependencies, {
        operation: description.label,
        label: description.label,
        type: description.type,
        layerIds: [layerId],
        before: ownedBefore,
        undoBase: ownedBefore,
        redoBase: ownedBefore,
        after: ownedAfter,
        edits: completed
      });
      return true;
    })) throw new Error('Apply Layer Mask could not be committed.');
    dependencies.setActiveChannel('pixels');
    dependencies.setError(null);
    if (present) dependencies.setStatus(`Applied layer mask to ${layer.name}`);
    return true;
  } catch (reason) {
    if (editOpen) renderer.cancelPixelEdit();
    for (const edit of [...edits].reverse()) {
      try { edit.undo(); } finally { edit.destroy(); }
    }
    transaction.cancel();
    if (present) dependencies.setError(
      reason instanceof Error ? reason.message : 'The layer mask could not be applied.'
    );
    return false;
  }
};
