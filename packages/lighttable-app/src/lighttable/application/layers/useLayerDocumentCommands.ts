import { useMemo, useRef } from 'react';
import type {
  ImageDocument,
  LayerId,
  Rect
} from '../../editor/document/documentTypes';
import { layerIsLocked } from '../../editor/document/documentTypes';
import {
  createAdjustmentLayer,
  duplicateLayer,
  createRasterLayer,
  flattenGroup,
  flattenImage,
  getFlattenGroupPlan,
  getFlattenImagePlan,
  getMergeLayersPlan,
  markLayerMaskPixelsChanged,
  markLayerPixelsChanged,
  mergeLayers as mergeDocumentLayers
} from '../../editor/document/documentCommands';
import {
  findDocumentLayer,
  findRasterLayer,
  siblingLayers
} from '../../editor/document/layerTree';
import type { ReversiblePixelEdit } from '../../editor/history/ReversiblePixelEdit';
import type { PaintChannel } from '../../editor/session/editorSession';
import type { SelectionOperation } from '../../editor/selection/selectionTypes';
import { selectionOperationsBounds } from '../../editor/tools/transform/selectionTransform';
import {
  adjustmentStackForOwner,
  adjustmentStackForScope,
  createAdjustmentStackFromBasicAdjustments
} from '../../processing/adjustmentStack';
import {
  createDefaultAdjustments,
  type BasicAdjustments
} from '../../types';
import type { LightTableImageClipboard } from '../../../platform/LightTableImageClipboard';

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
  copySelectedLayerContent(document: ImageDocument, layerId: LayerId): boolean;
  exportSelectionClipboard(bounds: Rect): Promise<Blob>;
  exportMergedSelection(bounds: Rect): Promise<Blob>;
  pasteClipboardImage(
    layerId: LayerId,
    blob: Blob,
    position: { x: number; y: number } | null
  ): Promise<boolean>;
  pasteSelectionClipboard(layerId: LayerId): boolean;
  hasSelectionClipboard(): boolean;
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
  getImageClipboard(): LightTableImageClipboard;
  getDocumentId(): string;
  applyDocumentSnapshot(document: ImageDocument): void;
  pushDocumentHistory(before: ImageDocument, after: ImageDocument): void;
  pushHistoryEntry(entry: LayerCommandHistoryEntry): void;
  setActiveChannel(channel: PaintChannel): void;
  setSelectionClipboardAvailable(available: boolean): void;
  setStatus(message: string | null): void;
  setError(message: string | null): void;
  getDocumentAdjustments?(): BasicAdjustments;
  getPanelAdjustments?(): BasicAdjustments;
  publishDocumentAdjustments?(adjustments: BasicAdjustments): void;
  publishPanelAdjustments?(adjustments: BasicAdjustments): void;
}

export interface LayerDocumentCommands {
  duplicateActiveLayer(): boolean;
  createAdjustmentLayer(): boolean;
  createLensFxLayer(): boolean;
  mergeSelectedRasterLayers(selectedLayerIds: LayerId[]): boolean;
  mergeActiveLayerDown(): boolean;
  flatten(request: FlattenRequest): boolean;
  invertActiveLayerColors(channel: PaintChannel): boolean;
  copySelectedContent(selection: readonly SelectionOperation[]): Promise<boolean>;
  copyMergedContent(selection: readonly SelectionOperation[]): Promise<boolean>;
  pasteSelectedContent(selection: readonly SelectionOperation[]): Promise<boolean>;
  layerViaCopy(selection: readonly SelectionOperation[]): boolean;
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
  let fastClipboardDocumentId: string | null = null;
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

  const createProcessingLayer = (owner: 'grade' | 'lens-fx') => {
    const dependencies = dependenciesRef.current;
    const current = dependencies.getDocument();
    const previousDocumentGrade = dependencies.getDocumentAdjustments?.();
    const currentPanelGrade = dependencies.getPanelAdjustments?.();
    if (
      !current
      || !previousDocumentGrade
      || !currentPanelGrade
      || !dependencies.publishDocumentAdjustments
      || !dependencies.publishPanelAdjustments
    ) return false;

    // A processing layer starts neutral and owns exactly one category.
    const source = createDefaultAdjustments();
    const stack = adjustmentStackForOwner(
      adjustmentStackForScope(
        createAdjustmentStackFromBasicAdjustments(source),
        'adjustment-layer'
      ),
      owner
    );
    const clearedDocumentGrade = createDefaultAdjustments();
    const next = createAdjustmentLayer(
      current,
      stack,
      owner === 'grade' ? 'Grade' : 'Lens Fx',
      current.activeLayerId ?? undefined
    );

    dependencies.publishDocumentAdjustments(clearedDocumentGrade);
    dependencies.applyDocumentSnapshot(next);
    dependencies.publishPanelAdjustments(source);
    dependencies.pushHistoryEntry({
      undo: () => {
        const latest = dependenciesRef.current;
        latest.publishDocumentAdjustments?.(previousDocumentGrade);
        latest.applyDocumentSnapshot(current);
        latest.publishPanelAdjustments?.(currentPanelGrade);
      },
      redo: () => {
        const latest = dependenciesRef.current;
        latest.publishDocumentAdjustments?.(clearedDocumentGrade);
        latest.applyDocumentSnapshot(next);
        latest.publishPanelAdjustments?.(source);
      }
    });
    dependencies.setActiveChannel('pixels');
    return true;
  };

  const createGradeAdjustmentLayer = () => createProcessingLayer('grade');
  const createLensFxLayer = () => createProcessingLayer('lens-fx');

  const mergeSelectedRasterLayers = (selectedLayerIds: LayerId[]) => {
    const current = dependenciesRef.current.getDocument();
    const renderer = dependenciesRef.current.getRenderer();
    if (!current || !renderer) return false;
    const plan = getMergeLayersPlan(current, selectedLayerIds);
    if (!plan) {
      dependenciesRef.current.setError(
        'Merge Selected requires contiguous raster or processing layers with a raster layer at the bottom.'
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
    const next = mergeDocumentLayers(current, plan.layerIds);
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
    if (!current?.activeLayerId) {
      dependenciesRef.current.setError('Select a layer with a raster layer directly below it.');
      return false;
    }
    const siblings = siblingLayers(current, current.activeLayerId);
    const index = siblings.findIndex((layer) => layer.id === current.activeLayerId);
    if (index <= 0) {
      dependenciesRef.current.setError('The active layer has no layer below it to merge with.');
      return false;
    }
    const top = siblings[index];
    const bottom = siblings[index - 1];
    if (top?.type === 'group' || bottom?.type !== 'raster') {
      dependenciesRef.current.setError(
        'Merge Down requires a raster layer directly below the active raster, Grade, or Lens Fx layer.'
      );
      return false;
    }
    const merged = mergeSelectedRasterLayers([bottom.id, top.id]);
    if (merged) dependenciesRef.current.setStatus('Layers merged');
    return merged;
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

  const clipboardBounds = (
    document: ImageDocument,
    selection: readonly SelectionOperation[]
  ) => selectionOperationsBounds([...selection], fullDocumentBounds(document));

  const writeClipboard = async (
    blob: Blob,
    document: ImageDocument,
    bounds: Rect
  ) => dependenciesRef.current.getImageClipboard().writeImage(blob, {
    sourceDocumentId: dependenciesRef.current.getDocumentId(),
    ...bounds
  });

  const copySelectedContent = async (selection: readonly SelectionOperation[]) => {
    const dependencies = dependenciesRef.current;
    const document = dependencies.getDocument();
    const renderer = dependencies.getRenderer();
    const activeLayer = document
      ? findRasterLayer(document, document.activeLayerId)
      : null;
    if (!document || !renderer || !activeLayer || !selection.length) return false;
    const bounds = clipboardBounds(document, selection);
    if (!renderer.copySelectedLayerContent(document, activeLayer.id)) {
      dependencies.setError(
        'The selected pixels could not be copied from the active layer.'
      );
      return false;
    }
    dependencies.setSelectionClipboardAvailable(true);
    try {
      await writeClipboard(
        await renderer.exportSelectionClipboard(bounds),
        document,
        bounds
      );
      fastClipboardDocumentId = dependencies.getDocumentId();
      dependencies.setStatus('Selected pixels copied to the system clipboard');
      dependencies.setError(null);
      return true;
    } catch (reason) {
      dependencies.setError(
        reason instanceof Error
          ? reason.message
          : 'The selected pixels could not be written to the system clipboard.'
      );
      return false;
    }
  };

  const copyMergedContent = async (selection: readonly SelectionOperation[]) => {
    const dependencies = dependenciesRef.current;
    const document = dependencies.getDocument();
    const renderer = dependencies.getRenderer();
    if (!document || !renderer || !selection.length) return false;
    const bounds = clipboardBounds(document, selection);
    fastClipboardDocumentId = null;
    try {
      await writeClipboard(
        await renderer.exportMergedSelection(bounds),
        document,
        bounds
      );
      dependencies.setSelectionClipboardAvailable(true);
      dependencies.setStatus('Merged selection copied to the system clipboard');
      dependencies.setError(null);
      return true;
    } catch (reason) {
      dependencies.setError(
        reason instanceof Error
          ? reason.message
          : 'The merged selection could not be copied.'
      );
      return false;
    }
  };

  const pasteSelectedContent = async (_selection: readonly SelectionOperation[]) => {
    const dependencies = dependenciesRef.current;
    const before = dependencies.getDocument();
    const renderer = dependencies.getRenderer();
    if (!before || !renderer) return false;
    let clipboardImage;
    try {
      clipboardImage = await dependencies.getImageClipboard().readImage();
    } catch (reason) {
      dependencies.setError(
        reason instanceof Error
          ? reason.message
          : 'The system clipboard could not be read.'
      );
      return false;
    }
    if (!clipboardImage) {
      dependencies.setError('The system clipboard does not contain an image.');
      return false;
    }
    const insertionTarget = before.activeLayerId ?? undefined;
    let after = createRasterLayer(before, 'Pasted Selection', insertionTarget);
    const pastedLayerId = after.activeLayerId;
    if (!pastedLayerId) return false;
    const sameDocumentCopy = (
      clipboardImage.placement?.sourceDocumentId === dependencies.getDocumentId()
      && fastClipboardDocumentId === dependencies.getDocumentId()
      && renderer.hasSelectionClipboard()
    );
    const dirtyBounds = sameDocumentCopy && clipboardImage.placement
      ? {
          x: clipboardImage.placement.x,
          y: clipboardImage.placement.y,
          width: clipboardImage.placement.width,
          height: clipboardImage.placement.height
        }
      : fullDocumentBounds(before);
    after = markLayerPixelsChanged(after, pastedLayerId, dirtyBounds);
    dependencies.applyDocumentSnapshot(after);
    const pasted = sameDocumentCopy
      ? renderer.pasteSelectionClipboard(pastedLayerId)
      : await renderer.pasteClipboardImage(
          pastedLayerId,
          clipboardImage.blob,
          clipboardImage.placement
            ? {
                x: clipboardImage.placement.x,
                y: clipboardImage.placement.y
              }
            : null
        );
    if (!pasted) {
      dependencies.applyDocumentSnapshot(before);
      dependencies.setError(
        'The copied pixels could not be pasted into a new layer.'
      );
      return false;
    }
    dependencies.pushDocumentHistory(before, after);
    dependencies.setActiveChannel('pixels');
    dependencies.setSelectionClipboardAvailable(true);
    dependencies.setStatus(
      sameDocumentCopy
        ? 'Pasted selection into a new layer'
        : 'Pasted system clipboard image into a new layer'
    );
    dependencies.setError(null);
    return true;
  };

  const layerViaCopy = (selection: readonly SelectionOperation[]) => {
    const before = dependenciesRef.current.getDocument();
    const renderer = dependenciesRef.current.getRenderer();
    const sourceId = before?.activeLayerId;
    if (!before || !renderer || !sourceId) return false;
    if (!selection.length) {
      const duplicated = duplicateActiveLayer();
      if (duplicated) dependenciesRef.current.setStatus('Layer copied');
      return duplicated;
    }

    const sourceLayer = findRasterLayer(before, sourceId);
    if (!sourceLayer || !renderer.copySelectedLayerContent(before, sourceId)) {
      dependenciesRef.current.setError(
        'The selected pixels could not be copied from the active layer.'
      );
      return false;
    }

    let after = createRasterLayer(before, `${sourceLayer.name} copy`, sourceId);
    const copiedLayerId = after.activeLayerId;
    if (!copiedLayerId) return false;
    after = markLayerPixelsChanged(
      after,
      copiedLayerId,
      selectionOperationsBounds([...selection], fullDocumentBounds(before))
    );
    dependenciesRef.current.applyDocumentSnapshot(after);
    if (!renderer.pasteSelectionClipboard(copiedLayerId)) {
      dependenciesRef.current.applyDocumentSnapshot(before);
      dependenciesRef.current.setError(
        'The selected pixels could not be placed on a new layer.'
      );
      return false;
    }
    dependenciesRef.current.pushDocumentHistory(before, after);
    dependenciesRef.current.setSelectionClipboardAvailable(true);
    dependenciesRef.current.setActiveChannel('pixels');
    dependenciesRef.current.setStatus('Selection copied to a new layer');
    dependenciesRef.current.setError(null);
    return true;
  };

  return {
    duplicateActiveLayer,
    createAdjustmentLayer: createGradeAdjustmentLayer,
    createLensFxLayer,
    mergeSelectedRasterLayers,
    mergeActiveLayerDown,
    flatten,
    invertActiveLayerColors,
    copySelectedContent,
    copyMergedContent,
    pasteSelectedContent,
    layerViaCopy
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
