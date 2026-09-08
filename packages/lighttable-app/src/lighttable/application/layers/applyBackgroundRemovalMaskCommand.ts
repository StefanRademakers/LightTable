import {
  addLayerMask,
  duplicateLayer,
  markLayerMaskPixelsChanged
} from '../../editor/document/documentCommands';
import { layerIsLocked, type ImageDocument, type LayerId, type RasterLayer } from '../../editor/document/documentTypes';
import { findDocumentLayer, findRasterLayer } from '../../editor/document/layerTree';
import type { ReversiblePixelEdit } from '../../editor/history/ReversiblePixelEdit';
import type { RasterSelectionMask } from '../../editor/selection/selectionTypes';
import { commitAppliedPixelMutation, type PixelMutationHistoryEntry } from '../commands/pixelMutationTransaction';
import type { DocumentMutationTransaction } from '../documents/useDocumentMutationController';

interface BackgroundMaskRendererPort {
  duplicateLayerPixels(sourceId: LayerId, destinationId: LayerId): boolean;
  prepareRasterDestination(destination: RasterLayer): boolean;
  commitRasterDestination(layerId: LayerId): void;
  releaseRasterDestination(layerId: LayerId): boolean;
  beginLayerPixelEdit(layerId: LayerId, channel: 'mask'): void;
  applyGeneratedLayerMask(
    layerId: LayerId,
    mask: RasterSelectionMask,
    mode: 'replace' | 'intersect'
  ): boolean;
  finishPixelEdit(): ReversiblePixelEdit | null;
  cancelPixelEdit(): void;
  applyPixelHistory(edit: ReversiblePixelEdit, direction: 'undo' | 'redo'): boolean;
}

interface BackgroundMaskDependencies {
  getRenderer(): BackgroundMaskRendererPort | null;
  applyDocumentSnapshot(document: ImageDocument): void;
  pushHistoryEntry(entry: PixelMutationHistoryEntry): void;
  setActiveChannel(channel: 'mask'): void;
  setStatus(message: string): void;
  setError(message: string | null): void;
}

type BeginBackgroundMaskTransaction = (
  key: string,
  description: { readonly label: string; readonly type: string }
) => DocumentMutationTransaction | null;

export const createApplyBackgroundRemovalMaskCommand = (
  resolveDependencies: () => BackgroundMaskDependencies,
  beginTransaction: BeginBackgroundMaskTransaction
) => (layerId: LayerId, mask: RasterSelectionMask,
  mode: 'replace' | 'intersect' | 'new-layer'): boolean => {
  const dependencies = resolveDependencies();
  const description = { label: 'Remove Background', type: 'layer.background-removal' } as const;
  const transaction = beginTransaction(`layer.background-removal:${layerId}`, description);
  if (!transaction) return false;
  const before = transaction.before;
  const renderer = dependencies.getRenderer();
  const source = findRasterLayer(before, layerId);
  if (!renderer || !source) {
    transaction.cancel();
    return false;
  }
  if (layerIsLocked(source, 'pixels')) {
    transaction.cancel();
    dependencies.setError('Unlock the active raster layer before removing its background.');
    return false;
  }
  if (mask.width !== before.width || mask.height !== before.height
    || mask.data.length !== before.width * before.height) {
    transaction.cancel();
    dependencies.setError('The generated background mask does not match this document.');
    return false;
  }

  let prepared = before;
  let targetId = layerId;
  if (mode === 'new-layer') {
    prepared = duplicateLayer(before, layerId);
    targetId = prepared.activeLayerId ?? layerId;
    if (prepared === before || targetId === layerId) {
      transaction.cancel();
      return false;
    }
  }
  if (!findDocumentLayer(prepared, targetId)?.mask) prepared = addLayerMask(prepared, targetId);
  if (!findDocumentLayer(prepared, targetId)?.mask) {
    transaction.cancel();
    return false;
  }

  let reservation: RasterLayer | null = null;
  let editOpen = false;
  let pixelEdit: ReversiblePixelEdit | null = null;
  try {
    if (mode === 'new-layer') {
      reservation = findRasterLayer(prepared, targetId);
      if (!reservation || !renderer.prepareRasterDestination(reservation)) {
        throw new Error('The background-removal layer could not be allocated on the GPU.');
      }
    }
    if (prepared !== before && !transaction.change(() => prepared)) {
      throw new Error('The background-removal preview could not be prepared.');
    }
    if (mode === 'new-layer' && !renderer.duplicateLayerPixels(layerId, targetId)) {
      throw new Error('The source layer pixels could not be duplicated.');
    }
    renderer.beginLayerPixelEdit(targetId, 'mask');
    editOpen = true;
    if (!renderer.applyGeneratedLayerMask(
      targetId, mask, mode === 'intersect' && source.mask ? 'intersect' : 'replace'
    )) throw new Error('The generated background mask could not be uploaded to the GPU.');
    pixelEdit = renderer.finishPixelEdit();
    editOpen = false;
    if (!pixelEdit) throw new Error('Background removal could not create a recoverable undo step.');
    const after = markLayerMaskPixelsChanged(prepared, targetId, {
      x: 0, y: 0, width: before.width, height: before.height
    });
    if (!transaction.stage(() => after)) {
      throw new Error('The background-removal transaction could not be staged.');
    }
    const completedEdit = pixelEdit;
    if (!transaction.commitWith((ownedBefore, ownedAfter) => {
      pixelEdit = null;
      commitAppliedPixelMutation(resolveDependencies, {
        operation: description.label,
        label: description.label,
        type: description.type,
        layerIds: [layerId, targetId],
        before: ownedBefore,
        redoBase: prepared,
        after: ownedAfter,
        // A new result retains both its RGBA16 color surface (8 B/px) and its
        // always-present R16 mask surface (2 B/px) across undo/redo.
        retainedByteSize: mode === 'new-layer' ? before.width * before.height * 10 : 0,
        edits: [completedEdit]
      });
      if (reservation) renderer.commitRasterDestination(reservation.id);
      return true;
    })) throw new Error('The background-removal transaction could not be committed.');
    dependencies.setActiveChannel('mask');
    dependencies.setError(null);
    dependencies.setStatus(mode === 'new-layer'
      ? `Created ${source.name} with a removable background mask`
      : `Removed the background from ${source.name}`);
    return true;
  } catch (reason) {
    if (editOpen) renderer.cancelPixelEdit();
    if (pixelEdit) {
      try { pixelEdit.undo(); } finally { pixelEdit.destroy(); }
    }
    transaction.cancel();
    if (reservation) renderer.releaseRasterDestination(reservation.id);
    dependencies.setError(
      reason instanceof Error ? reason.message : 'The generated background mask could not be applied.'
    );
    return false;
  }
};
