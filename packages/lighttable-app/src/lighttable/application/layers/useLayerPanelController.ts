import { useMemo, useRef } from 'react';
import { applyLayerCreation } from './applyLayerCreation';
import type { BasicAdjustments } from '../../types';
import { isFilterKind } from '@lighttable/filter-core';
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
  setActiveLayer,
  setLayerBlendMode,
  setLayerClipping,
  setLayerFillOpacity,
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
import { materializeBasicAdjustments } from '../../processing/adjustmentStack';
import type { LocalProcessingKind } from '../../processing/adjustmentStack';
import type { GradeModuleGroup } from '../../processing/adjustmentStack';
import type {
  AdjustmentInitialSettings,
  AdjustmentLayerKind
} from '../../processing/adjustmentLayerCatalog';
import {
  canRestoreLayerVisibility,
  captureLayerVisibility,
  planAllLayerVisibility,
  planRestoreLayerVisibility,
  planSoloLayerVisibility,
  type LayerVisibilityChange,
  type LayerVisibilitySnapshot
} from './layerVisibilityIsolation';

export interface LayerPanelControllerDependencies {
  getDocument(): ImageDocument | null;
  getDocumentAdjustments(): BasicAdjustments;
  mutateDocument(
    mutate: (current: ImageDocument) => ImageDocument,
    recordHistory?: boolean
  ): boolean;
  publishPanelAdjustments(adjustments: BasicAdjustments): void;
  setPaintTarget(channel: PaintChannel, brushColor?: string): void;
  beginDocumentTransaction(): boolean;
  endDocumentTransaction(): boolean;
  cancelDocumentTransaction(): boolean;
  createAdjustmentLayer(): boolean;
  createCurvesAdjustmentLayer(): boolean;
  createLensFxLayer(): boolean;
  createAdjustmentLayerOfKind(kind: AdjustmentLayerKind, aboveLayerId?: LayerId,
    settings?: AdjustmentInitialSettings): boolean;
  createAttachedAdjustment(layerId: LayerId, kind: AdjustmentLayerKind,
    settings?: AdjustmentInitialSettings): string | null;
  requestAddLayerMask(): void;
  requestToggleLayerMask(): void;
  requestSetLayerMaskLinked(layerId: LayerId, linked: boolean): void;
  requestRemoveLayerMask(layerId?: LayerId): void;
  duplicateActiveLayer(): boolean;
  rasterizeActiveLayer(): Promise<boolean>;
  loadLayerMaskSelection(layerId: LayerId): void | Promise<void>;
  loadLayerTransparencySelection(layerId: LayerId): void | Promise<void>;
  mergeActiveLayerDown(): void;
  mergeSelectedLayers(layerIds: LayerId[]): void;
  flattenGroup(groupId: LayerId): void;
  flattenImage(): void;
  editStyles(layerId: LayerId, effectId?: LayerStyleId): void;
  setStyleStackEnabled(layerId: LayerId, enabled: boolean): void;
  setStyleEnabled(layerId: LayerId, effectId: LayerStyleId, enabled: boolean): void;
  removeStyle(layerId: LayerId, effectId: LayerStyleId): void;
  clearStyles(layerId: LayerId): void;
  finishStyleEditing(): void;
  finishProcessingEditing?(): void;
  setAttachedFilterEnabled(layerId: LayerId, adjustmentId: string, enabled: boolean): boolean;
  prepareActiveLayerChange?(layerId: LayerId): void | Promise<void>;
  finishTextEditing?(): void;
}

export interface LayerPanelController {
  select(layerId: LayerId): Promise<void>;
  changeChannel(channel: PaintChannel): void;
  setVisibility(layerIds: LayerId[], visible: boolean): void;
  toggleSoloVisibility(layerId: LayerId): void;
  setOtherLayersVisibility(layerId: LayerId, visible: boolean): void;
  setAllLayersVisibility(visible: boolean): void;
  beginVisibilityInteraction(): boolean;
  previewVisibility(layerIds: LayerId[], visible: boolean): void;
  endVisibilityInteraction(): void;
  cancelVisibilityInteraction(): void;
  rename(layerId: LayerId, name: string): void;
  setOpacity(layerId: LayerId, opacity: number): void;
  setVectorAntiAlias(layerId: LayerId, antiAlias: boolean): void;
  setFillOpacity(layerId: LayerId, opacity: number): void;
  beginOpacityInteraction(): boolean;
  endOpacityInteraction(): void;
  cancelOpacityInteraction(): void;
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
  createAdjustmentLayerOfKind(kind: AdjustmentLayerKind, aboveLayerId?: LayerId,
    settings?: AdjustmentInitialSettings): boolean;
  createAttachedAdjustment(layerId: LayerId, kind: AdjustmentLayerKind,
    settings?: AdjustmentInitialSettings): string | null;
  createGroup(): void;
  groupSelection(layerIds: LayerId[]): void;
  ungroupSelection(layerIds: LayerId[]): void;
  deleteSelection(layerIds: LayerId[]): void;
  duplicateActive(): void;
  rasterizeActive(): void;
  mergeDown(): void;
  mergeSelected(layerIds: LayerId[]): void;
  flattenGroup(groupId: LayerId): void;
  flattenImage(): void;
  editStyles(layerId: LayerId, effectId?: LayerStyleId): void;
  setStyleStackEnabled(layerId: LayerId, enabled: boolean): void;
  setStyleEnabled(layerId: LayerId, effectId: LayerStyleId, enabled: boolean): void;
  removeStyle(layerId: LayerId, effectId: LayerStyleId): void;
  clearStyles(layerId: LayerId): void;
  setLocalGradeEnabled(layerId: LayerId, enabled: boolean): void;
  setLocalCurvesEnabled(layerId: LayerId, enabled: boolean): void;
  setLocalLensFxEnabled(layerId: LayerId, enabled: boolean): void;
  setGradeGroupEnabled(ownerId: LayerId, group: GradeModuleGroup, enabled: boolean): void;
  removeLocalProcessing(layerId: LayerId, owner: LocalProcessingKind): void;
  setAttachedAdjustmentEnabled(layerId: LayerId, adjustmentId: string, enabled: boolean): void;
  removeAttachedAdjustment(layerId: LayerId, adjustmentId: string): void;
}

/**
 * Owns the semantic commands exposed by the Layers panel.
 *
 * The panel is deliberately kept unaware of document mutation/history rules,
 * adjustment-layer projection and editor-channel changes. Keeping those
 * coupled operations here also prevents a future docked/floating Layers panel
 * from acquiring a second, subtly different command implementation.
 */
export interface LayerPanelMutationController extends LayerPanelController {
  createGradientFillLayer(): LayerId | null;
  createGroup(): LayerId | null;
  groupSelection(layerIds: LayerId[]): LayerId | null;
}

export const createLayerPanelController = (
  resolveDependencies: () => LayerPanelControllerDependencies
): LayerPanelMutationController => {
  let soloVisibility: LayerVisibilitySnapshot | null = null;
  let visibilityInteractionActive = false;
  let opacityInteractionActive = false;
  const mutate = (
    change: (current: ImageDocument) => ImageDocument,
    recordHistory = true
  ) => resolveDependencies().mutateDocument(change, recordHistory);

  const applyVisibilityChanges = (changes: readonly LayerVisibilityChange[]) => {
    if (!changes.length) return;
    mutate((current) => changes.reduce(
      (next, change) => setLayersVisibility(next, change.layerIds, change.visible),
      current
    ));
  };

  const select = async (layerId: LayerId) => {
    const dependencies = resolveDependencies();
    const current = dependencies.getDocument();
    const layer = current ? findDocumentLayer(current, layerId) : null;
    if (!current || !layer) return;

    await dependencies.prepareActiveLayerChange?.(layerId);

    // The preparation step may asynchronously commit a renderer-owned
    // transform and publish a newer document revision. Resolve the target
    // again so selection never overwrites that commit with a stale snapshot.
    const preparedDocument = resolveDependencies().getDocument();
    const preparedLayer = preparedDocument
      ? findDocumentLayer(preparedDocument, layerId)
      : null;
    if (!preparedDocument || !preparedLayer) return;

    dependencies.mutateDocument(
      (document) => setActiveLayer(document, layerId),
      false
    );
    const panelAdjustments = (
      preparedLayer.type === 'adjustment'
      || (preparedLayer.type === 'raster' && preparedLayer.adjustmentStack)
    )
      // Bypassed Grade and Lens Fx modules still expose their authored values.
      ? materializeBasicAdjustments(preparedLayer.adjustmentStack!, undefined, undefined, true)
      : createDefaultAdjustments();
    dependencies.publishPanelAdjustments(cloneAdjustments(panelAdjustments));
  };

  const usePixelChannel = (
    change: (current: ImageDocument) => ImageDocument
  ) => {
    mutate(change);
    resolveDependencies().setPaintTarget('pixels');
  };

  const createPixelLayer = (create: (current: ImageDocument) => ImageDocument) => {
    const dependencies = resolveDependencies();
    const layerId = applyLayerCreation(
      (change) => dependencies.mutateDocument(change), create
    );
    if (layerId) dependencies.setPaintTarget('pixels');
    return layerId;
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
    setVisibility: (layerIds, visible) => {
      soloVisibility = null;
      mutate((current) => setLayersVisibility(current, layerIds, visible));
    },
    toggleSoloVisibility: (layerId) => {
      const document = resolveDependencies().getDocument();
      if (!document) return;
      if (soloVisibility?.targetLayerId === layerId
        && canRestoreLayerVisibility(document, soloVisibility)) {
        applyVisibilityChanges(planRestoreLayerVisibility(document, soloVisibility));
        soloVisibility = null;
        return;
      }
      soloVisibility = captureLayerVisibility(document, layerId);
      applyVisibilityChanges(planSoloLayerVisibility(document, layerId));
    },
    setOtherLayersVisibility: (layerId, visible) => {
      soloVisibility = null;
      const document = resolveDependencies().getDocument();
      if (document) applyVisibilityChanges(visible
        ? planAllLayerVisibility(document, true, layerId)
        : planSoloLayerVisibility(document, layerId));
    },
    setAllLayersVisibility: (visible) => {
      soloVisibility = null;
      const document = resolveDependencies().getDocument();
      if (document) applyVisibilityChanges(planAllLayerVisibility(document, visible));
    },
    beginVisibilityInteraction: () => {
      soloVisibility = null;
      visibilityInteractionActive = resolveDependencies().beginDocumentTransaction();
      return visibilityInteractionActive;
    },
    previewVisibility: (layerIds, visible) =>
      mutate((current) => setLayersVisibility(current, layerIds, visible)),
    endVisibilityInteraction: () => {
      if (!visibilityInteractionActive) return;
      visibilityInteractionActive = false;
      resolveDependencies().endDocumentTransaction();
    },
    cancelVisibilityInteraction: () => {
      if (!visibilityInteractionActive) return;
      visibilityInteractionActive = false;
      resolveDependencies().cancelDocumentTransaction();
    },
    rename: (layerId, name) =>
      mutate((current) => renameLayer(current, layerId, name)),
    setOpacity: (layerId, opacity) =>
      mutate((current) => setLayerOpacity(current, layerId, opacity)),
    setVectorAntiAlias: (layerId, antiAlias) =>
      mutate((current) => setVectorLayerAntiAlias(current, layerId, antiAlias)),
    setFillOpacity: (layerId, opacity) =>
      mutate((current) => setLayerFillOpacity(current, layerId, opacity)),
    beginOpacityInteraction: () => {
      opacityInteractionActive = resolveDependencies().beginDocumentTransaction();
      return opacityInteractionActive;
    },
    endOpacityInteraction: () => {
      if (!opacityInteractionActive) return;
      opacityInteractionActive = false;
      resolveDependencies().endDocumentTransaction();
    },
    cancelOpacityInteraction: () => {
      if (!opacityInteractionActive) return;
      opacityInteractionActive = false;
      resolveDependencies().cancelDocumentTransaction();
    },
    setBlendMode: (layerId, blendMode) =>
      mutate((current) => setLayerBlendMode(current, layerId, blendMode)),
    setClipping: (layerId, clipping) =>
      mutate((current) => setLayerClipping(current, layerId, clipping)),
    reorder: (layerIds, targetLayerId, placement) =>
      mutate((current) =>
        moveLayerSelection(current, layerIds, targetLayerId, placement)),
    addMask: () => resolveDependencies().requestAddLayerMask(),
    loadMaskSelection: (layerId) =>
      resolveDependencies().loadLayerMaskSelection(layerId),
    loadTransparencySelection: (layerId) =>
      resolveDependencies().loadLayerTransparencySelection(layerId),
    toggleMask: () => resolveDependencies().requestToggleLayerMask(),
    setMaskLinked: (layerId, linked) =>
      resolveDependencies().requestSetLayerMaskLinked(layerId, linked),
    removeMask: (layerId) => resolveDependencies().requestRemoveLayerMask(layerId),
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
      createPixelLayer((current) => createGradientFillLayer(current)),
    createLensFxLayer: () => resolveDependencies().createLensFxLayer(),
    createAdjustmentLayerOfKind: (kind, aboveLayerId, settings) =>
      resolveDependencies().createAdjustmentLayerOfKind(kind, aboveLayerId, settings),
    createAttachedAdjustment: (layerId, kind, settings) =>
      resolveDependencies().createAttachedAdjustment(layerId, kind, settings),
    createGroup: () =>
      createPixelLayer((current) => createGroupLayer(current)),
    groupSelection: (layerIds) =>
      createPixelLayer((current) => groupLayers(current, layerIds)),
    ungroupSelection: (layerIds) =>
      usePixelChannel((current) => ungroupLayers(current, layerIds)),
    deleteSelection: (layerIds) => {
      resolveDependencies().finishTextEditing?.();
      usePixelChannel((current) => deleteLayers(current, layerIds));
    },
    duplicateActive: () => { resolveDependencies().duplicateActiveLayer(); },
    rasterizeActive: () => {
      const dependencies = resolveDependencies();
      dependencies.finishTextEditing?.();
      void dependencies.rasterizeActiveLayer();
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
      resolveDependencies().setStyleStackEnabled(layerId, enabled),
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
    setAttachedAdjustmentEnabled: (layerId, adjustmentId, enabled) => {
      const dependencies = resolveDependencies();
      const document = dependencies.getDocument();
      const layer = document ? findDocumentLayer(document, layerId) : null;
      const adjustment = layer?.type === 'raster'
        ? (layer.attachedAdjustments ?? []).find(({ id }) => id === adjustmentId)
        : null;
      if (adjustment && isFilterKind(adjustment.adjustmentKind)) {
        dependencies.setAttachedFilterEnabled(layerId, adjustmentId, enabled);
        return;
      }
      mutate((current) => setRasterLayerAttachedAdjustmentEnabled(
        current, layerId, adjustmentId, enabled
      ));
    },
    removeAttachedAdjustment: (layerId, adjustmentId) => {
      resolveDependencies().finishProcessingEditing?.();
      mutate((current) => removeRasterLayerAttachedAdjustment(
        current, layerId, adjustmentId
      ));
    },
    setStyleEnabled: (layerId, effectId, enabled) =>
      resolveDependencies().setStyleEnabled(layerId, effectId, enabled),
    removeStyle: (layerId, effectId) => {
      const dependencies = resolveDependencies();
      dependencies.finishStyleEditing();
      dependencies.removeStyle(layerId, effectId);
    },
    clearStyles: (layerId) => {
      const dependencies = resolveDependencies();
      dependencies.finishStyleEditing();
      dependencies.clearStyles(layerId);
    },
  };
};

export const useLayerPanelController = (
  dependencies: LayerPanelControllerDependencies
): LayerPanelMutationController => {
  const dependenciesRef = useRef(dependencies);
  dependenciesRef.current = dependencies;
  return useMemo(
    () => createLayerPanelController(() => dependenciesRef.current),
    []
  );
};
