import { useMemo, useRef } from 'react';
import type {
  ImageDocument,
  LayerId
} from '../../editor/document/documentTypes';
import { layerIsLocked } from '../../editor/document/documentTypes';
import {
  duplicateLayer,
  flattenGroup,
  flattenImage,
  getFlattenGroupPlan,
  getFlattenImagePlan,
  getMergeRasterLayersPlan,
  markLayerMaskPixelsChanged,
  markLayerPixelsChanged,
  mergeRasterLayers
} from '../../editor/document/documentCommands';
import {
  findDocumentLayer,
  findRasterLayer,
  siblingLayers
} from '../../editor/document/layerTree';
import type { ReversiblePixelEdit } from '../../editor/rendering/LayerDocumentRenderer';
import type { PaintChannel } from '../../editor/session/editorSession';

export type FlattenRequest =
  | { kind: 'group'; groupId: LayerId }
  | { kind: 'image' };

export interface LayerCommandHistoryEntry {
  byteSize?: number;
  layerIds?: readonly LayerId[];
  undo(): void | Promise<void>;
  redo(): void | Promise<void>;
  dispose?(): void;
}

export interface LayerCommandRendererPort {
  duplicateLayerPixels(sourceId: LayerId, destinationId: LayerId): void;
  beginLayerPixelEdit(layerId: LayerId, channel?: PaintChannel): void;
  mergeLayers(
    document: ImageDocument,
    layerIds: readonly LayerId[],
    destinationId: LayerId
  ): boolean;
  flattenGroup(document: ImageDocument, groupId: LayerId, destinationId: LayerId): boolean;
  flattenImage(document: ImageDocument, destinationId: LayerId): boolean;
  invertLayerColors(layerId: LayerId, channel?: PaintChannel): boolean;
  finishPixelEdit(): ReversiblePixelEdit | null;
  cancelPixelEdit(): void;
  applyPixelHistory(
    edit: ReversiblePixelEdit,
    direction: 'undo' | 'redo'
  ): boolean;
}

export interface LayerDocumentCommandDependencies {
  getDocument(): ImageDocument | null;
  getRenderer(): LayerCommandRendererPort | null;
  applyDocumentSnapshot(document: ImageDocument): void;
  pushDocumentHistory(before: ImageDocument, after: ImageDocument): void;
  pushHistoryEntry(entry: LayerCommandHistoryEntry): void;
  setActiveChannel(channel: PaintChannel): void;
  setStatus(message: string | null): void;
  setError(message: string | null): void;
}

export interface LayerDocumentCommands {
  duplicateActiveLayer(): boolean;
  mergeSelectedRasterLayers(selectedLayerIds: LayerId[]): boolean;
  mergeActiveLayerDown(): boolean;
  flatten(request: FlattenRequest): boolean;
  invertActiveLayerColors(channel: PaintChannel): boolean;
}

const fullDocumentBounds = (document: ImageDocument) => ({
  x: 0,
  y: 0,
  width: document.width,
  height: document.height
});

/**
 * Owns renderer-backed layer mutations as atomic application transactions.
 *
 * React chooses the command and presents errors. This controller alone
 * coordinates document snapshots, GPU pixel edits, undo resources and the
 * active edit channel. Dependencies are resolved at invocation time so an
 * inactive workspace document can never receive a command from a stale render.
 */
export const createLayerDocumentCommands = (
  resolveDependencies: () => LayerDocumentCommandDependencies
): LayerDocumentCommands => {
  const dependenciesRef = {
    get current() {
      return resolveDependencies();
    }
  };

  const duplicateActiveLayer = () => {
    const current = dependenciesRef.current.getDocument();
    if (!current?.activeLayerId) return false;
    const sourceId = current.activeLayerId;
    const next = duplicateLayer(current, sourceId);
    if (next === current || !next.activeLayerId) return false;

    dependenciesRef.current.applyDocumentSnapshot(next);
    dependenciesRef.current
      .getRenderer()
      ?.duplicateLayerPixels(sourceId, next.activeLayerId);
    dependenciesRef.current.pushDocumentHistory(current, next);
    dependenciesRef.current.setActiveChannel('pixels');
    return true;
  };

  const mergeSelectedRasterLayers = (selectedLayerIds: LayerId[]) => {
    const current = dependenciesRef.current.getDocument();
    const renderer = dependenciesRef.current.getRenderer();
    if (!current || !renderer) return false;
    const plan = getMergeRasterLayersPlan(current, selectedLayerIds);
    if (!plan) {
      dependenciesRef.current.setError(
        'Merge Selected requires two or more contiguous raster layers in the same group.'
      );
      return false;
    }

    renderer.beginLayerPixelEdit(plan.destinationId);
    if (!renderer.mergeLayers(current, plan.layerIds, plan.destinationId)) {
      renderer.cancelPixelEdit();
      dependenciesRef.current.setError('The selected layers could not be merged on the GPU.');
      return false;
    }

    const pixelEdit = renderer.finishPixelEdit();
    if (!pixelEdit) {
      renderer.cancelPixelEdit();
      dependenciesRef.current.setError(
        'The merged result could not create a recoverable undo step.'
      );
      return false;
    }
    const next = mergeRasterLayers(current, plan.layerIds);
    dependenciesRef.current.applyDocumentSnapshot(next);
    dependenciesRef.current.pushHistoryEntry({
      byteSize: pixelEdit.byteSize,
      layerIds: plan.layerIds,
      undo: () => {
        dependenciesRef.current.applyDocumentSnapshot(current);
        if (!dependenciesRef.current.getRenderer()?.applyPixelHistory(pixelEdit, 'undo')) {
          throw new Error('Merge undo is no longer available.');
        }
      },
      redo: () => {
        if (!dependenciesRef.current.getRenderer()?.applyPixelHistory(pixelEdit, 'redo')) {
          throw new Error('Merge redo is no longer available.');
        }
        dependenciesRef.current.applyDocumentSnapshot(next);
      },
      dispose: pixelEdit.destroy
    });
    dependenciesRef.current.setActiveChannel('pixels');
    dependenciesRef.current.setError(null);
    return true;
  };

  const mergeActiveLayerDown = () => {
    const current = dependenciesRef.current.getDocument();
    if (!current?.activeLayerId) return false;
    const siblings = siblingLayers(current, current.activeLayerId);
    const index = siblings.findIndex((layer) => layer.id === current.activeLayerId);
    if (index <= 0) return false;
    const top = siblings[index];
    const bottom = siblings[index - 1];
    if (top?.type !== 'raster' || bottom?.type !== 'raster') return false;
    return mergeSelectedRasterLayers([bottom.id, top.id]);
  };

  const flatten = (request: FlattenRequest) => {
    const current = dependenciesRef.current.getDocument();
    const renderer = dependenciesRef.current.getRenderer();
    if (!current || !renderer) return false;
    const plan = request.kind === 'group'
      ? getFlattenGroupPlan(current, request.groupId)
      : getFlattenImagePlan(current);
    if (!plan) {
      dependenciesRef.current.setError(
        request.kind === 'group'
          ? 'This group cannot be flattened until its adjustment layers are rasterized.'
          : 'This image cannot be flattened until its adjustment layers are rasterized.'
      );
      return false;
    }

    renderer.beginLayerPixelEdit(plan.destinationId);
    const rendered = request.kind === 'group'
      ? renderer.flattenGroup(current, request.groupId, plan.destinationId)
      : renderer.flattenImage(current, plan.destinationId);
    if (!rendered) {
      renderer.cancelPixelEdit();
      dependenciesRef.current.setError('The layer stack could not be flattened on the GPU.');
      return false;
    }

    const pixelEdit = renderer.finishPixelEdit();
    const next = request.kind === 'group'
      ? flattenGroup(current, request.groupId)
      : flattenImage(current);
    if (!pixelEdit || next === current) {
      pixelEdit?.destroy();
      dependenciesRef.current.setError(
        'The flattened result could not create a recoverable undo step.'
      );
      return false;
    }

    dependenciesRef.current.applyDocumentSnapshot(next);
    dependenciesRef.current.pushHistoryEntry({
      byteSize: pixelEdit.byteSize,
      layerIds: plan.layerIds,
      undo: () => {
        dependenciesRef.current.applyDocumentSnapshot(current);
        if (!dependenciesRef.current.getRenderer()?.applyPixelHistory(pixelEdit, 'undo')) {
          throw new Error('Flatten undo is no longer available.');
        }
      },
      redo: () => {
        if (!dependenciesRef.current.getRenderer()?.applyPixelHistory(pixelEdit, 'redo')) {
          throw new Error('Flatten redo is no longer available.');
        }
        dependenciesRef.current.applyDocumentSnapshot(next);
      },
      dispose: pixelEdit.destroy
    });
    dependenciesRef.current.setActiveChannel('pixels');
    dependenciesRef.current.setError(null);
    dependenciesRef.current.setStatus(
      request.kind === 'group' ? 'Group flattened' : 'Image flattened'
    );
    return true;
  };

  const invertActiveLayerColors = (channel: PaintChannel) => {
    const current = dependenciesRef.current.getDocument();
    const layerId = current?.activeLayerId;
    const activeLayer = current
      ? (
          channel === 'mask'
            ? findDocumentLayer(current, layerId ?? null)
            : findRasterLayer(current, layerId ?? null)
        )
      : null;
    const renderer = dependenciesRef.current.getRenderer();
    if (!current || !layerId || !activeLayer || !renderer) return false;
    if (layerIsLocked(activeLayer, 'pixels')) {
      dependenciesRef.current.setError(
        `Unlock the active layer before inverting its ${channel === 'mask' ? 'mask' : 'colors'}.`
      );
      return false;
    }
    if (channel === 'mask' && !activeLayer.mask) {
      dependenciesRef.current.setError('Add or select a layer mask before inverting it.');
      return false;
    }

    try {
      renderer.beginLayerPixelEdit(layerId, channel);
      if (!renderer.invertLayerColors(layerId, channel)) {
        renderer.cancelPixelEdit();
        throw new Error(
          `The active ${channel === 'mask' ? 'mask' : 'layer pixels'} are not available on the GPU.`
        );
      }
      const pixelEdit = renderer.finishPixelEdit();
      if (!pixelEdit) throw new Error('The invert operation could not create an undo snapshot.');
      const next = channel === 'mask'
        ? markLayerMaskPixelsChanged(current, layerId, fullDocumentBounds(current))
        : markLayerPixelsChanged(current, layerId, fullDocumentBounds(current));
      dependenciesRef.current.applyDocumentSnapshot(next);
      dependenciesRef.current.pushHistoryEntry({
        byteSize: pixelEdit.byteSize,
        layerIds: [layerId],
        undo: () => {
          if (!dependenciesRef.current.getRenderer()?.applyPixelHistory(pixelEdit, 'undo')) {
            throw new Error('Invert colors undo is no longer available.');
          }
          dependenciesRef.current.applyDocumentSnapshot(current);
        },
        redo: () => {
          if (!dependenciesRef.current.getRenderer()?.applyPixelHistory(pixelEdit, 'redo')) {
            throw new Error('Invert colors redo is no longer available.');
          }
          dependenciesRef.current.applyDocumentSnapshot(next);
        },
        dispose: pixelEdit.destroy
      });
      dependenciesRef.current.setError(null);
      dependenciesRef.current.setStatus(
        `Inverted ${channel === 'mask' ? 'mask' : 'colors'} on ${activeLayer.name}`
      );
      return true;
    } catch (reason) {
      renderer.cancelPixelEdit();
      dependenciesRef.current.setError(
        reason instanceof Error
          ? reason.message
          : `The active ${channel === 'mask' ? 'mask' : 'layer colors'} could not be inverted.`
      );
      return false;
    }
  };

  return {
    duplicateActiveLayer,
    mergeSelectedRasterLayers,
    mergeActiveLayerDown,
    flatten,
    invertActiveLayerColors
  };
};

export const useLayerDocumentCommands = (
  dependencies: LayerDocumentCommandDependencies
): LayerDocumentCommands => {
  const dependenciesRef = useRef(dependencies);
  dependenciesRef.current = dependencies;
  return useMemo(
    () => createLayerDocumentCommands(() => dependenciesRef.current),
    []
  );
};
