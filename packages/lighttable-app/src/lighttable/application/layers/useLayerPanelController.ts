import { useMemo, useRef } from 'react';
import type { BasicAdjustments } from '../../types';
import { cloneAdjustments, createDefaultAdjustments } from '../../types';
import type { BlendMode } from '../../editor/document/blendModes';
import type {
  ImageDocument,
  LayerId,
  LayerLocks
} from '../../editor/document/documentTypes';
import {
  createGroupLayer,
  createGradientFillLayer,
  createRasterLayer,
  deleteLayers,
  groupLayers,
  moveLayer,
  moveLayerSelection,
  renameLayer,
  removeLayerMask,
  setActiveLayer,
  setLayerBlendMode,
  setLayerClipping,
  setLayerFillOpacity,
  setLayerMaskLinked,
  setLayerMaskEnabled,
  setLayerOpacity,
  setVectorLayerAntiAlias,
  ensureRasterLayerLocalProcessing,
  setRasterLayerLocalProcessingEnabled,
  removeRasterLayerLocalProcessing,
  removeRasterLayerAttachedAdjustment,
  setRasterLayerAttachedAdjustmentEnabled,
  setGradeOwnerGroupEnabled,
  setLayersLock,
  setLayersVisibility,
  ungroupLayers
} from '../../editor/document/documentCommands';
import {
  findDocumentLayer,
  siblingLayers
} from '../../editor/document/layerTree';
import type { PaintChannel } from '../../editor/session/editorSession';
import type { LayerStyleId } from '../../editor/styles/layerStyleTypes';
import {
  clearLayerStyles,
  removeLayerStyle,
  setLayerStyleEnabled,
  setLayerStyleStackEnabled
} from '../../editor/styles/layerStyleCommands';
import { materializeBasicAdjustments } from '../../processing/adjustmentStack';
import type { LocalProcessingKind } from '../../processing/adjustmentStack';
import type { GradeModuleGroup } from '../../processing/adjustmentStack';
import type { AdjustmentLayerKind } from '../../processing/adjustmentLayerCatalog';

export interface LayerPanelControllerDependencies {
  getDocument(): ImageDocument | null;
  getDocumentAdjustments(): BasicAdjustments;
  mutateDocument(
    mutate: (current: ImageDocument) => ImageDocument,
    recordHistory?: boolean
  ): void;
  publishPanelAdjustments(adjustments: BasicAdjustments): void;
  setPaintTarget(channel: PaintChannel, brushColor?: string): void;
  beginDocumentTransaction(): void;
  endDocumentTransaction(): void;
  createAdjustmentLayer(): boolean;
  createCurvesAdjustmentLayer(): boolean;
  createLensFxLayer(): boolean;
  createAdjustmentLayerOfKind(kind: AdjustmentLayerKind, aboveLayerId?: LayerId): boolean;
  createAttachedAdjustment(layerId: LayerId, kind: AdjustmentLayerKind): string | null;
  addActiveLayerMask(): boolean;
  duplicateActiveLayer(): boolean;
  rasterizeActiveTextLayer(): boolean;
  loadLayerMaskSelection(layerId: LayerId): void;
  loadLayerTransparencySelection(layerId: LayerId): void;
  mergeActiveLayerDown(): void;
  mergeSelectedLayers(layerIds: LayerId[]): void;
  flattenGroup(groupId: LayerId): void;
  flattenImage(): void;
  editStyles(layerId: LayerId, effectId?: LayerStyleId): void;
  finishStyleEditing?(): void;
  finishProcessingEditing?(): void;
  prepareActiveLayerChange?(layerId: LayerId): void;
  finishTextEditing?(): void;
}

export interface LayerPanelController {
  select(layerId: LayerId): void;
  changeChannel(channel: PaintChannel): void;
  setVisibility(layerIds: LayerId[], visible: boolean): void;
  rename(layerId: LayerId, name: string): void;
  setOpacity(layerId: LayerId, opacity: number): void;
  setVectorAntiAlias(layerId: LayerId, antiAlias: boolean): void;
  setFillOpacity(layerId: LayerId, opacity: number): void;
  beginOpacityInteraction(): void;
  endOpacityInteraction(): void;
  setBlendMode(layerId: LayerId, blendMode: BlendMode): void;
  setClipping(layerId: LayerId, clipping: boolean): void;
  reorder(
    layerIds: LayerId[],
    targetLayerId: LayerId,
    placement: 'above' | 'below' | 'inside'
  ): void;
  addMask(): void;
  loadMaskSelection(layerId: LayerId): void;
  loadTransparencySelection(layerId: LayerId): void;
  toggleMask(): void;
  setMaskLinked(layerId: LayerId, linked: boolean): void;
  removeMask(layerId?: LayerId): void;
  move(layerId: LayerId, direction: 'up' | 'down'): void;
  moveActive(direction: 'up' | 'down'): void;
  setLock(layerIds: LayerId[], lock: keyof LayerLocks, locked: boolean): void;
  createRasterLayer(): void;
  createAdjustmentLayer(): boolean;
  createCurvesAdjustmentLayer(): boolean;
  createLocalProcessing(layerId: LayerId, kind: LocalProcessingKind): void;
  createGradientFillLayer(): void;
  createLensFxLayer(): boolean;
  createAdjustmentLayerOfKind(kind: AdjustmentLayerKind, aboveLayerId?: LayerId): boolean;
  createAttachedAdjustment(layerId: LayerId, kind: AdjustmentLayerKind): string | null;
  createGroup(): void;
  groupSelection(layerIds: LayerId[]): void;
  ungroupSelection(layerIds: LayerId[]): void;
  deleteSelection(layerIds: LayerId[]): void;
  duplicateActive(): void;
  rasterizeActiveText(): void;
  mergeDown(): void;
  mergeSelected(layerIds: LayerId[]): void;
  flattenGroup(groupId: LayerId): void;
  flattenImage(): void;
  editStyles(layerId: LayerId, effectId?: LayerStyleId): void;
  setStyleStackEnabled(layerId: LayerId, enabled: boolean): void;
  setLocalGradeEnabled(layerId: LayerId, enabled: boolean): void;
  setLocalCurvesEnabled(layerId: LayerId, enabled: boolean): void;
  setLocalLensFxEnabled(layerId: LayerId, enabled: boolean): void;
  setGradeGroupEnabled(ownerId: LayerId, group: GradeModuleGroup, enabled: boolean): void;
  removeLocalProcessing(layerId: LayerId, owner: LocalProcessingKind): void;
  setAttachedAdjustmentEnabled(layerId: LayerId, adjustmentId: string, enabled: boolean): void;
  removeAttachedAdjustment(layerId: LayerId, adjustmentId: string): void;
  setStyleEnabled(layerId: LayerId, effectId: LayerStyleId, enabled: boolean): void;
  removeStyle(layerId: LayerId, effectId: LayerStyleId): void;
  clearStyles(layerId: LayerId): void;
}

/**
 * Owns the semantic commands exposed by the Layers panel.
 *
 * The panel is deliberately kept unaware of document mutation/history rules,
 * adjustment-layer projection and editor-channel changes. Keeping those
 * coupled operations here also prevents a future docked/floating Layers panel
 * from acquiring a second, subtly different command implementation.
 */
export const createLayerPanelController = (
  resolveDependencies: () => LayerPanelControllerDependencies
): LayerPanelController => {
  const mutate = (
    change: (current: ImageDocument) => ImageDocument,
    recordHistory = true
  ) => resolveDependencies().mutateDocument(change, recordHistory);

  const select = (layerId: LayerId) => {
    const dependencies = resolveDependencies();
    const current = dependencies.getDocument();
    const layer = current ? findDocumentLayer(current, layerId) : null;
    if (!current || !layer) return;

    dependencies.prepareActiveLayerChange?.(layerId);

    dependencies.mutateDocument(
      (document) => setActiveLayer(document, layerId),
      false
    );
    const panelAdjustments = (
      layer.type === 'adjustment'
      || (layer.type === 'raster' && layer.adjustmentStack)
    )
      // Bypassed Grade and Lens Fx modules still expose their authored values.
      ? materializeBasicAdjustments(layer.adjustmentStack!, undefined, undefined, true)
      : createDefaultAdjustments();
    dependencies.publishPanelAdjustments(cloneAdjustments(panelAdjustments));
  };

  const usePixelChannel = (
    change: (current: ImageDocument) => ImageDocument
  ) => {
    mutate(change);
    resolveDependencies().setPaintTarget('pixels');
  };

  const move = (layerId: LayerId, direction: 'up' | 'down') => {
    const dependencies = resolveDependencies();
    const document = dependencies.getDocument();
    if (!document || !findDocumentLayer(document, layerId)) return;
    const siblings = siblingLayers(document, layerId);
    const activeIndex = siblings.findIndex((layer) => layer.id === layerId);
    const targetIndex = activeIndex + (direction === 'up' ? 1 : -1);
    if (activeIndex < 0 || targetIndex < 0 || targetIndex >= siblings.length) return;
    dependencies.mutateDocument((current) => moveLayer(current, layerId, targetIndex));
  };

  return {
    select,
    changeChannel: (channel) => resolveDependencies().setPaintTarget(channel),
    setVisibility: (layerIds, visible) =>
      mutate((current) => setLayersVisibility(current, layerIds, visible)),
    rename: (layerId, name) =>
      mutate((current) => renameLayer(current, layerId, name)),
    setOpacity: (layerId, opacity) =>
      mutate((current) => setLayerOpacity(current, layerId, opacity)),
    setVectorAntiAlias: (layerId, antiAlias) =>
      mutate((current) => setVectorLayerAntiAlias(current, layerId, antiAlias)),
    setFillOpacity: (layerId, opacity) =>
      mutate((current) => setLayerFillOpacity(current, layerId, opacity)),
    beginOpacityInteraction: () => resolveDependencies().beginDocumentTransaction(),
    endOpacityInteraction: () => resolveDependencies().endDocumentTransaction(),
    setBlendMode: (layerId, blendMode) =>
      mutate((current) => setLayerBlendMode(current, layerId, blendMode)),
    setClipping: (layerId, clipping) =>
      mutate((current) => setLayerClipping(current, layerId, clipping)),
    reorder: (layerIds, targetLayerId, placement) =>
      mutate((current) =>
        moveLayerSelection(current, layerIds, targetLayerId, placement)),
    addMask: () => {
      const dependencies = resolveDependencies();
      if (dependencies.addActiveLayerMask()) {
        dependencies.setPaintTarget('mask', '#000000');
      }
    },
    loadMaskSelection: (layerId) =>
      resolveDependencies().loadLayerMaskSelection(layerId),
    loadTransparencySelection: (layerId) =>
      resolveDependencies().loadLayerTransparencySelection(layerId),
    toggleMask: () => {
      const dependencies = resolveDependencies();
      const document = dependencies.getDocument();
      const layer = document
        ? findDocumentLayer(document, document.activeLayerId)
        : null;
      if (!layer?.mask) return;
      dependencies.mutateDocument((current) =>
        setLayerMaskEnabled(current, layer.id, !layer.mask!.enabled));
    },
    setMaskLinked: (layerId, linked) =>
      mutate((current) => setLayerMaskLinked(current, layerId, linked)),
    removeMask: (requestedLayerId) => {
      const dependencies = resolveDependencies();
      const layerId = requestedLayerId ?? dependencies.getDocument()?.activeLayerId;
      if (!layerId) return;
      dependencies.mutateDocument((current) =>
        removeLayerMask(current, layerId));
      dependencies.setPaintTarget('pixels');
    },
    move,
    moveActive: (direction) => {
      const layerId = resolveDependencies().getDocument()?.activeLayerId;
      if (!layerId) return;
      move(layerId, direction);
    },
    setLock: (layerIds, lock, locked) =>
      mutate((current) => setLayersLock(current, layerIds, lock, locked)),
    createRasterLayer: () =>
      usePixelChannel((current) => createRasterLayer(current)),
    createAdjustmentLayer: () => resolveDependencies().createAdjustmentLayer(),
    createCurvesAdjustmentLayer: () => resolveDependencies().createCurvesAdjustmentLayer(),
    createLocalProcessing: (layerId, kind) =>
      mutate((current) => ensureRasterLayerLocalProcessing(current, layerId, kind)),
    createGradientFillLayer: () =>
      usePixelChannel((current) => createGradientFillLayer(current)),
    createLensFxLayer: () => resolveDependencies().createLensFxLayer(),
    createAdjustmentLayerOfKind: (kind, aboveLayerId) =>
      resolveDependencies().createAdjustmentLayerOfKind(kind, aboveLayerId),
    createAttachedAdjustment: (layerId, kind) =>
      resolveDependencies().createAttachedAdjustment(layerId, kind),
    createGroup: () =>
      usePixelChannel((current) => createGroupLayer(current)),
    groupSelection: (layerIds) =>
      usePixelChannel((current) => groupLayers(current, layerIds)),
    ungroupSelection: (layerIds) =>
      usePixelChannel((current) => ungroupLayers(current, layerIds)),
    deleteSelection: (layerIds) => {
      resolveDependencies().finishTextEditing?.();
      usePixelChannel((current) => deleteLayers(current, layerIds));
    },
    duplicateActive: () => { resolveDependencies().duplicateActiveLayer(); },
    rasterizeActiveText: () => {
      const dependencies = resolveDependencies();
      dependencies.finishTextEditing?.();
      dependencies.rasterizeActiveTextLayer();
    },
    mergeDown: () => {
      const dependencies = resolveDependencies();
      dependencies.finishTextEditing?.();
      dependencies.mergeActiveLayerDown();
    },
    mergeSelected: (layerIds) => {
      const dependencies = resolveDependencies();
      dependencies.finishTextEditing?.();
      dependencies.mergeSelectedLayers(layerIds);
    },
    flattenGroup: (groupId) => {
      const dependencies = resolveDependencies();
      dependencies.finishTextEditing?.();
      dependencies.flattenGroup(groupId);
    },
    flattenImage: () => {
      const dependencies = resolveDependencies();
      dependencies.finishTextEditing?.();
      dependencies.flattenImage();
    },
    editStyles: (layerId, effectId) =>
      resolveDependencies().editStyles(layerId, effectId),
    setStyleStackEnabled: (layerId, enabled) =>
      mutate((current) => setLayerStyleStackEnabled(current, layerId, enabled)),
    setLocalGradeEnabled: (layerId, enabled) =>
      mutate((current) => setRasterLayerLocalProcessingEnabled(
        ensureRasterLayerLocalProcessing(current, layerId, 'grade'),
        layerId,
        enabled,
        'grade'
      )),
    setLocalCurvesEnabled: (layerId, enabled) =>
      mutate((current) =>
        setRasterLayerLocalProcessingEnabled(current, layerId, enabled, 'curves')),
    setLocalLensFxEnabled: (layerId, enabled) =>
      mutate((current) =>
        setRasterLayerLocalProcessingEnabled(current, layerId, enabled, 'lens-fx')),
    setGradeGroupEnabled: (ownerId, group, enabled) =>
      mutate((current) => setGradeOwnerGroupEnabled(current, ownerId, group, enabled)),
    removeLocalProcessing: (layerId, owner) => {
      resolveDependencies().finishProcessingEditing?.();
      mutate((current) =>
        removeRasterLayerLocalProcessing(current, layerId, owner));
    },
    setAttachedAdjustmentEnabled: (layerId, adjustmentId, enabled) =>
      mutate((current) => setRasterLayerAttachedAdjustmentEnabled(
        current, layerId, adjustmentId, enabled
      )),
    removeAttachedAdjustment: (layerId, adjustmentId) => {
      resolveDependencies().finishProcessingEditing?.();
      mutate((current) => removeRasterLayerAttachedAdjustment(
        current, layerId, adjustmentId
      ));
    },
    setStyleEnabled: (layerId, effectId, enabled) =>
      mutate((current) =>
        setLayerStyleEnabled(current, layerId, effectId, enabled)),
    removeStyle: (layerId, effectId) => {
      resolveDependencies().finishStyleEditing?.();
      mutate((current) => removeLayerStyle(current, layerId, effectId));
    },
    clearStyles: (layerId) => {
      resolveDependencies().finishStyleEditing?.();
      mutate((current) => clearLayerStyles(current, layerId));
    }
  };
};

export const useLayerPanelController = (
  dependencies: LayerPanelControllerDependencies
): LayerPanelController => {
  const dependenciesRef = useRef(dependencies);
  dependenciesRef.current = dependencies;
  return useMemo(
    () => createLayerPanelController(() => dependenciesRef.current),
    []
  );
};
