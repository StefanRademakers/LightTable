import { useMemo, useRef } from 'react';
import type {
  ImageDocument,
  LayerId,
  Rect
} from '../../editor/document/documentTypes';
import { layerIsLocked } from '../../editor/document/documentTypes';
import {
  addLayerMask,
  addRasterLayerAttachedAdjustment,
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
  mergeLayers as mergeDocumentLayers,
  rasterizeTextLayer
} from '../../editor/document/documentCommands';
import { createPlacedRasterLayer } from '../../editor/document/placedRasterLayerCommand';
import {
  findDocumentLayer,
  findRasterLayer,
  siblingLayers
} from '../../editor/document/layerTree';
import type { ReversiblePixelEdit } from '../../editor/history/ReversiblePixelEdit';
import type { DocumentAssetBlob } from '../../editor/persistence/layeredDocumentFormat';
import type { PaintChannel } from '../../editor/session/editorSession';
import type { SelectionOperation } from '../../editor/selection/selectionTypes';
import type { RasterSelectionMask } from '../../editor/selection/selectionTypes';
import { selectionOperationsSupportBounds } from '../../editor/tools/transform/selectionTransform';
import {
  adjustmentStackForScope,
  createAdjustmentStackFromBasicAdjustments
} from '../../processing/adjustmentStack';
import {
  createDefaultAdjustments,
  type BasicAdjustments
} from '../../types';
import type { LightTableImageClipboard } from '../../../platform/LightTableImageClipboard';
import {
  adjustmentLayerDefinition,
  selectAdjustmentLayerModules,
  type AdjustmentLayerKind
} from '../../processing/adjustmentLayerCatalog';

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
  prepareRasterDestination(destination: import('../../editor/document/documentTypes').RasterLayer): boolean;
  commitRasterDestination(layerId: LayerId): void;
  releaseRasterDestination(layerId: LayerId): boolean;
  rasterizeText(
    document: ImageDocument,
    source: import('../../editor/document/documentTypes').TextLayer,
    destination: import('../../editor/document/documentTypes').RasterLayer
  ): boolean;
  invertLayerColors(layerId: LayerId, channel?: PaintChannel): boolean;
  bakeSelectionIntoLayerMask(layerId: LayerId): boolean;
  applyGeneratedLayerMask(
    layerId: LayerId,
    mask: RasterSelectionMask,
    mode: 'replace' | 'intersect'
  ): boolean;
  copySelectedLayerContent(document: ImageDocument, layerId: LayerId): boolean;
  exportSelectionClipboard(bounds: Rect): Promise<Blob>;
  exportMergedSelection(bounds: Rect): Promise<Blob>;
  pasteClipboardImage(
    layerId: LayerId,
    blob: Blob,
    position: { x: number; y: number } | null
  ): Promise<boolean>;
  loadLayerAssets(assets: DocumentAssetBlob[]): Promise<void>;
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
  addActiveLayerMask(useSelection: boolean): boolean;
  applyBackgroundRemovalMask(
    mask: RasterSelectionMask,
    mode: 'replace' | 'intersect' | 'new-layer'
  ): boolean;
  duplicateActiveLayer(): boolean;
  createAdjustmentLayer(): boolean;
  createCurvesAdjustmentLayer(): boolean;
  createLensFxLayer(): boolean;
  createAdjustmentLayerOfKind(kind: AdjustmentLayerKind): boolean;
  createAttachedAdjustment(layerId: LayerId, kind: AdjustmentLayerKind): string | null;
  mergeSelectedLayers(selectedLayerIds: LayerId[]): boolean;
  mergeActiveLayerDown(): boolean;
  flatten(request: FlattenRequest): boolean;
  rasterizeActiveTextLayer(): boolean;
  invertActiveLayerColors(channel: PaintChannel): boolean;
  copySelectedContent(selection: readonly SelectionOperation[]): Promise<boolean>;
  copyMergedContent(selection: readonly SelectionOperation[]): Promise<boolean>;
  pasteSelectedContent(selection: readonly SelectionOperation[]): Promise<boolean>;
  placeImageArtifact(file: File, placement?: {
    readonly name?: string;
    readonly x?: number;
    readonly y?: number;
  }): Promise<{ readonly layerId: LayerId; readonly width: number; readonly height: number } | null>;
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

  const addActiveLayerMask = (useSelection: boolean) => {
    const dependencies = dependenciesRef.current;
    const current = dependencies.getDocument();
    const layerId = current?.activeLayerId;
    const layer = current && layerId
      ? findDocumentLayer(current, layerId)
      : null;
    if (!current || !layerId || !layer || layer.mask) return false;

    const withMask = addLayerMask(current, layerId);
    if (withMask === current) return false;

    dependencies.applyDocumentSnapshot(withMask);
    if (!useSelection) {
      dependencies.pushDocumentHistory(current, withMask);
      dependencies.setActiveChannel('mask');
      dependencies.setError(null);
      dependencies.setStatus(`Added layer mask to ${layer.name}`);
      return true;
    }

    const renderer = dependencies.getRenderer();
    if (!renderer) {
      dependencies.applyDocumentSnapshot(current);
      dependencies.setError('The current selection could not be baked into a layer mask.');
      return false;
    }

    try {
      renderer.beginLayerPixelEdit(layerId, 'mask');
      if (!renderer.bakeSelectionIntoLayerMask(layerId)) {
        throw new Error('The current selection could not be copied into the layer mask.');
      }
      const pixelEdit = renderer.finishPixelEdit();
      if (!pixelEdit) {
        throw new Error('The layer mask could not create a recoverable undo step.');
      }
      const next = markLayerMaskPixelsChanged(
        withMask,
        layerId,
        fullDocumentBounds(current)
      );
      dependencies.applyDocumentSnapshot(next);
      dependencies.pushHistoryEntry({
        byteSize: pixelEdit.byteSize,
        layerIds: [layerId],
        undo: () => {
          if (!dependenciesRef.current.getRenderer()?.applyPixelHistory(pixelEdit, 'undo')) {
            throw new Error('Add layer mask undo is no longer available.');
          }
          dependenciesRef.current.applyDocumentSnapshot(current);
        },
        redo: () => {
          dependenciesRef.current.applyDocumentSnapshot(withMask);
          if (!dependenciesRef.current.getRenderer()?.applyPixelHistory(pixelEdit, 'redo')) {
            throw new Error('Add layer mask redo is no longer available.');
          }
          dependenciesRef.current.applyDocumentSnapshot(next);
        },
        dispose: pixelEdit.destroy
      });
      dependencies.setActiveChannel('mask');
      dependencies.setError(null);
      dependencies.setStatus(`Added selection as a mask to ${layer.name}`);
      return true;
    } catch (reason) {
      renderer.cancelPixelEdit();
      dependencies.applyDocumentSnapshot(current);
      dependencies.setError(
        reason instanceof Error
          ? reason.message
          : 'The current selection could not be baked into a layer mask.'
      );
      return false;
    }
  };

  const duplicateActiveLayer = () => {
    const current = dependenciesRef.current.getDocument();
    if (!current?.activeLayerId) return false;
    const sourceId = current.activeLayerId;
    const source = findDocumentLayer(current, sourceId);
    const next = duplicateLayer(current, sourceId);
    if (next === current || !next.activeLayerId) return false;

    dependenciesRef.current.applyDocumentSnapshot(next);
    if (source?.type === 'raster') {
      dependenciesRef.current
        .getRenderer()
        ?.duplicateLayerPixels(sourceId, next.activeLayerId);
    }
    dependenciesRef.current.pushDocumentHistory(current, next);
    dependenciesRef.current.setActiveChannel('pixels');
    return true;
  };

  const applyBackgroundRemovalMask = (
    mask: RasterSelectionMask,
    mode: 'replace' | 'intersect' | 'new-layer'
  ) => {
    const dependencies = dependenciesRef.current;
    const before = dependencies.getDocument();
    const renderer = dependencies.getRenderer();
    const sourceId = before?.activeLayerId;
    const source = before && sourceId ? findRasterLayer(before, sourceId) : null;
    if (!before || !renderer || !sourceId || !source) return false;
    if (layerIsLocked(source, 'pixels')) {
      dependencies.setError('Unlock the active raster layer before removing its background.');
      return false;
    }
    if (mask.width !== before.width || mask.height !== before.height) {
      dependencies.setError('The generated background mask does not match this document.');
      return false;
    }

    let prepared = before;
    let targetId = sourceId;
    if (mode === 'new-layer') {
      prepared = duplicateLayer(before, sourceId);
      targetId = prepared.activeLayerId ?? sourceId;
      if (prepared === before || targetId === sourceId) return false;
    }
    const target = findDocumentLayer(prepared, targetId);
    if (!target?.mask) prepared = addLayerMask(prepared, targetId);
    if (!findDocumentLayer(prepared, targetId)?.mask) return false;

    try {
      dependencies.applyDocumentSnapshot(prepared);
      if (mode === 'new-layer') renderer.duplicateLayerPixels(sourceId, targetId);
      renderer.beginLayerPixelEdit(targetId, 'mask');
      if (!renderer.applyGeneratedLayerMask(
        targetId,
        mask,
        mode === 'intersect' && source.mask ? 'intersect' : 'replace'
      )) {
        throw new Error('The generated background mask could not be uploaded to the GPU.');
      }
      const pixelEdit = renderer.finishPixelEdit();
      if (!pixelEdit) throw new Error('Background removal could not create a recoverable undo step.');
      const after = markLayerMaskPixelsChanged(prepared, targetId, fullDocumentBounds(before));
      dependencies.applyDocumentSnapshot(after);
      dependencies.pushHistoryEntry({
        byteSize: pixelEdit.byteSize,
        layerIds: [targetId],
        undo: () => {
          if (!dependenciesRef.current.getRenderer()?.applyPixelHistory(pixelEdit, 'undo')) {
            throw new Error('Background removal undo is no longer available.');
          }
          dependenciesRef.current.applyDocumentSnapshot(before);
        },
        redo: () => {
          dependenciesRef.current.applyDocumentSnapshot(prepared);
          if (!dependenciesRef.current.getRenderer()?.applyPixelHistory(pixelEdit, 'redo')) {
            throw new Error('Background removal redo is no longer available.');
          }
          dependenciesRef.current.applyDocumentSnapshot(after);
        },
        dispose: pixelEdit.destroy
      });
      dependencies.setActiveChannel('mask');
      dependencies.setError(null);
      dependencies.setStatus(
        mode === 'new-layer'
          ? `Created ${source.name} with a removable background mask`
          : `Removed the background from ${source.name}`
      );
      return true;
    } catch (reason) {
      renderer.cancelPixelEdit();
      dependencies.applyDocumentSnapshot(before);
      dependencies.setError(
        reason instanceof Error ? reason.message : 'The generated background mask could not be applied.'
      );
      return false;
    }
  };

  const createProcessingLayer = (kind: AdjustmentLayerKind) => {
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

    // A processing layer starts neutral and owns an explicit module inventory.
    const source = createDefaultAdjustments();
    const definition = adjustmentLayerDefinition(kind);
    if (definition.photoshopKind) {
      source.photoshopAdjustment.kind = definition.photoshopKind;
    }
    if (kind === 'gradient-map' && source.gradientMap) {
      source.gradientMap.enabled = true;
    }
    if (kind === 'grain') source.effects.grain.enabled = true;
    const stack = selectAdjustmentLayerModules(adjustmentStackForScope(
      createAdjustmentStackFromBasicAdjustments(source),
      'adjustment-layer'
    ), kind);
    const clearedDocumentGrade = createDefaultAdjustments();
    const next = createAdjustmentLayer(
      current,
      stack,
      definition.name,
      current.activeLayerId ?? undefined,
      kind
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
  const createCurvesAdjustmentLayer = () => createProcessingLayer('curves');
  const createLensFxLayer = () => createProcessingLayer('lens-fx');

  const createAttachedAdjustment = (layerId: LayerId, kind: AdjustmentLayerKind) => {
    const dependencies = dependenciesRef.current;
    const current = dependencies.getDocument();
    const layer = current ? findRasterLayer(current, layerId) : null;
    if (!current || !layer || layerIsLocked(layer, 'pixels')) return null;
    const source = createDefaultAdjustments();
    const definition = adjustmentLayerDefinition(kind);
    if (definition.photoshopKind) source.photoshopAdjustment.kind = definition.photoshopKind;
    if (kind === 'gradient-map' && source.gradientMap) source.gradientMap.enabled = true;
    if (kind === 'grain') source.effects.grain.enabled = true;
    const adjustmentStack = selectAdjustmentLayerModules(adjustmentStackForScope(
      createAdjustmentStackFromBasicAdjustments(source),
      'layer'
    ), kind);
    const adjustmentId = `attached-${crypto.randomUUID()}`;
    const next = addRasterLayerAttachedAdjustment(current, layerId, {
      id: adjustmentId,
      adjustmentKind: kind,
      name: definition.name,
      enabled: true,
      revision: 0,
      adjustmentStack
    });
    if (next === current) return null;
    dependencies.applyDocumentSnapshot(next);
    dependencies.publishPanelAdjustments?.(source);
    dependencies.pushDocumentHistory(current, next);
    dependencies.setActiveChannel('pixels');
    dependencies.setStatus(`Attached ${definition.name} to ${layer.name}`);
    dependencies.setError(null);
    return adjustmentId;
  };

  const mergeSelectedLayers = (selectedLayerIds: LayerId[]) => {
    const current = dependenciesRef.current.getDocument();
    const renderer = dependenciesRef.current.getRenderer();
    if (!current || !renderer) return false;
    const plan = getMergeLayersPlan(current, selectedLayerIds);
    if (!plan) {
      dependenciesRef.current.setError(
        'Merge Selected requires at least two contiguous layers in the same group.'
      );
      return false;
    }

    const next = mergeDocumentLayers(current, plan.layerIds);
    const destination = findRasterLayer(next, next.activeLayerId);
    if (next === current || !destination || !renderer.prepareRasterDestination(destination)) {
      dependenciesRef.current.setError('The full-canvas merge destination could not be allocated.');
      return false;
    }
    if (!renderer.mergeLayers(current, plan.layerIds, destination.id)) {
      renderer.releaseRasterDestination(destination.id);
      dependenciesRef.current.setError('The selected layers could not be merged on the GPU.');
      return false;
    }
    dependenciesRef.current.applyDocumentSnapshot(next);
    dependenciesRef.current.pushHistoryEntry({
      byteSize: current.width * current.height * 8,
      layerIds: [...plan.layerIds, destination.id],
      undo: () => {
        dependenciesRef.current.applyDocumentSnapshot(current);
      },
      redo: () => {
        dependenciesRef.current.applyDocumentSnapshot(next);
      }
    });
    renderer.commitRasterDestination(destination.id);
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
    if (!top || !bottom) {
      dependenciesRef.current.setError('The active layer has no layer below it to merge with.');
      return false;
    }
    const merged = mergeSelectedLayers([bottom.id, top.id]);
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
          ? 'This group has no layers to flatten.'
          : 'This image has no layers to flatten.'
      );
      return false;
    }

    const next = request.kind === 'group'
      ? flattenGroup(current, request.groupId)
      : flattenImage(current);
    const destination = findRasterLayer(next, next.activeLayerId);
    if (next === current || !destination || !renderer.prepareRasterDestination(destination)) {
      dependenciesRef.current.setError('The full-canvas flatten destination could not be allocated.');
      return false;
    }
    const rendered = request.kind === 'group'
      ? renderer.flattenGroup(current, request.groupId, destination.id)
      : renderer.flattenImage(current, destination.id);
    if (!rendered) {
      renderer.releaseRasterDestination(destination.id);
      dependenciesRef.current.setError('The layer stack could not be flattened on the GPU.');
      return false;
    }

    dependenciesRef.current.applyDocumentSnapshot(next);
    dependenciesRef.current.pushHistoryEntry({
      byteSize: current.width * current.height * 8,
      layerIds: [...plan.layerIds, destination.id],
      undo: () => {
        dependenciesRef.current.applyDocumentSnapshot(current);
      },
      redo: () => {
        dependenciesRef.current.applyDocumentSnapshot(next);
      }
    });
    renderer.commitRasterDestination(destination.id);
    dependenciesRef.current.setActiveChannel('pixels');
    dependenciesRef.current.setError(null);
    dependenciesRef.current.setStatus(
      request.kind === 'group' ? 'Group flattened' : 'Image flattened'
    );
    return true;
  };

  const rasterizeActiveTextLayer = () => {
    const dependencies = dependenciesRef.current;
    const current = dependencies.getDocument();
    const renderer = dependencies.getRenderer();
    const source = current ? findDocumentLayer(current, current.activeLayerId) : null;
    if (!current || source?.type !== 'text' || !renderer) {
      dependencies.setError('Select a text layer to rasterize.');
      return false;
    }
    const next = rasterizeTextLayer(current, source.id);
    const destination = findRasterLayer(next, source.id);
    if (next === current || !destination) {
      dependencies.setError('The text layer is locked or cannot be rasterized.');
      return false;
    }

    let editOpen = false;
    let pixelEdit: ReversiblePixelEdit | null = null;
    try {
      if (!renderer.prepareRasterDestination(destination)) {
        dependencies.setError('The raster destination could not be allocated on the GPU.');
        return false;
      }
      renderer.beginLayerPixelEdit(destination.id);
      editOpen = true;
      if (!renderer.rasterizeText(current, source, destination)) {
        renderer.cancelPixelEdit();
        editOpen = false;
        renderer.releaseRasterDestination(destination.id);
        dependencies.setError('The text layer could not be rasterized on the GPU.');
        return false;
      }
      pixelEdit = renderer.finishPixelEdit();
      editOpen = false;
      if (!pixelEdit) {
        renderer.releaseRasterDestination(destination.id);
        dependencies.setError('Rasterize Type could not create a recoverable undo step.');
        return false;
      }
      const completedEdit = pixelEdit;
      dependencies.applyDocumentSnapshot(next);
      dependencies.pushHistoryEntry({
        byteSize: completedEdit.byteSize,
        layerIds: [source.id],
        undo: () => {
          dependencies.applyDocumentSnapshot(current);
          if (!dependencies.getRenderer()?.applyPixelHistory(completedEdit, 'undo')) {
            throw new Error('Rasterize Type undo is no longer available.');
          }
        },
        redo: () => {
          if (!dependencies.getRenderer()?.applyPixelHistory(completedEdit, 'redo')) {
            throw new Error('Rasterize Type redo is no longer available.');
          }
          dependencies.applyDocumentSnapshot(next);
        },
        dispose: completedEdit.destroy
      });
      renderer.commitRasterDestination(destination.id);
      pixelEdit = null;
      dependencies.setActiveChannel('pixels');
      dependencies.setError(null);
      dependencies.setStatus('Text layer rasterized');
      return true;
    } catch (reason) {
      if (editOpen) renderer.cancelPixelEdit();
      if (pixelEdit) {
        pixelEdit.undo();
        pixelEdit.destroy();
      }
      if (dependencies.getDocument() === next) {
        dependencies.applyDocumentSnapshot(current);
      }
      renderer.releaseRasterDestination(destination.id);
      dependencies.setError(
        reason instanceof Error ? reason.message : 'The text layer could not be rasterized.'
      );
      return false;
    }
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
  ) => selectionOperationsSupportBounds([...selection], fullDocumentBounds(document));

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

  const pasteSelectedContent = async (selection: readonly SelectionOperation[]) => {
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
    const selectionPlacement = selection.length
      ? clipboardBounds(before, selection)
      : null;
    const requestedPlacement = clipboardImage.placement ?? selectionPlacement;
    const dirtyBounds = sameDocumentCopy && clipboardImage.placement
      ? {
          x: clipboardImage.placement.x,
          y: clipboardImage.placement.y,
          width: clipboardImage.placement.width,
          height: clipboardImage.placement.height
        }
      : fullDocumentBounds(before);
    // Publish the empty layer first so the renderer can allocate its texture.
    // Do not publish the pixel revision until the clipboard write succeeds:
    // layer thumbnails key their GPU readback cache by pixelRevision and would
    // otherwise permanently cache the still-empty destination texture.
    dependencies.applyDocumentSnapshot(after);
    const pasted = sameDocumentCopy
      ? renderer.pasteSelectionClipboard(pastedLayerId)
      : await renderer.pasteClipboardImage(
          pastedLayerId,
          clipboardImage.blob,
          requestedPlacement
            ? {
                x: requestedPlacement.x,
                y: requestedPlacement.y
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
    after = markLayerPixelsChanged(after, pastedLayerId, dirtyBounds);
    dependencies.applyDocumentSnapshot(after);
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

  const placeImageArtifact: LayerDocumentCommands['placeImageArtifact'] = async (file, placement = {}) => {
    const dependencies = dependenciesRef.current;
    const before = dependencies.getDocument();
    const renderer = dependencies.getRenderer();
    if (!before || !renderer) return null;
    let bitmap: ImageBitmap | null = null;
    let preparedLayerId: LayerId | null = null;
    try {
      bitmap = await createImageBitmap(file);
      const width = bitmap.width;
      const height = bitmap.height;
      if (width < 1 || height < 1 || width > 32_768 || height > 32_768
        || width * height > 268_435_456) {
        throw new Error('Placed image dimensions exceed the supported resource bounds.');
      }
      const x = Number.isFinite(placement.x)
        ? Math.round(placement.x!)
        : Math.round((before.width - width) / 2);
      const y = Number.isFinite(placement.y)
        ? Math.round(placement.y!)
        : Math.round((before.height - height) / 2);
      const name = placement.name?.trim() || file.name.replace(/\.[^.]+$/, '') || 'Placed image';
      const after = createPlacedRasterLayer(before, { name, width, height, x, y });
      const layerId = after.activeLayerId;
      if (!layerId) return null;
      const layer = findRasterLayer(after, layerId);
      if (!layer || !renderer.prepareRasterDestination(layer)) return null;
      preparedLayerId = layerId;
      await renderer.loadLayerAssets([{ layerId, pixels: file, mask: null }]);
      renderer.commitRasterDestination(layerId);
      preparedLayerId = null;
      dependencies.applyDocumentSnapshot(after);
      dependencies.pushDocumentHistory(before, after);
      dependencies.setActiveChannel('pixels');
      dependencies.setStatus(`Placed ${name}`);
      dependencies.setError(null);
      return { layerId, width, height };
    } catch (reason) {
      if (preparedLayerId) renderer.releaseRasterDestination(preparedLayerId);
      dependencies.setError(reason instanceof Error ? reason.message : 'The image could not be placed.');
      return null;
    } finally {
      bitmap?.close();
    }
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
    const dirtyBounds = selectionOperationsSupportBounds(
      [...selection],
      fullDocumentBounds(before)
    );
    // As with regular paste, allocate the destination before the GPU copy and
    // publish its pixel revision only after the texture contains the pixels.
    dependenciesRef.current.applyDocumentSnapshot(after);
    if (!renderer.pasteSelectionClipboard(copiedLayerId)) {
      dependenciesRef.current.applyDocumentSnapshot(before);
      dependenciesRef.current.setError(
        'The selected pixels could not be placed on a new layer.'
      );
      return false;
    }
    after = markLayerPixelsChanged(after, copiedLayerId, dirtyBounds);
    dependenciesRef.current.applyDocumentSnapshot(after);
    dependenciesRef.current.pushDocumentHistory(before, after);
    dependenciesRef.current.setSelectionClipboardAvailable(true);
    dependenciesRef.current.setActiveChannel('pixels');
    dependenciesRef.current.setStatus('Selection copied to a new layer');
    dependenciesRef.current.setError(null);
    return true;
  };

  return {
    addActiveLayerMask,
    applyBackgroundRemovalMask,
    duplicateActiveLayer,
    createAdjustmentLayer: createGradeAdjustmentLayer,
    createCurvesAdjustmentLayer,
    createLensFxLayer,
    createAdjustmentLayerOfKind: createProcessingLayer,
    createAttachedAdjustment,
    mergeSelectedLayers,
    mergeActiveLayerDown,
    flatten,
    rasterizeActiveTextLayer,
    invertActiveLayerColors,
    copySelectedContent,
    copyMergedContent,
    pasteSelectedContent,
    placeImageArtifact,
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
