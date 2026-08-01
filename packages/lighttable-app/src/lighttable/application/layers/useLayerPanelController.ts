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
  setLayerMaskEnabled,
  setLayerOpacity,
  setVectorLayerAntiAlias,
  setRasterLayerAdjustmentStackEnabled,
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
  setLayerStyleEnabled,
  setLayerStyleStackEnabled
} from '../../editor/styles/layerStyleCommands';
import { materializeBasicAdjustments } from '../../processing/adjustmentStack';

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
  createAdjustmentLayer(): void;
  createLensFxLayer(): void;
  addActiveLayerMask(): boolean;
  loadLayerMaskSelection(layerId: LayerId): void;
  mergeActiveLayerDown(): void;
  mergeSelectedRasterLayers(layerIds: LayerId[]): void;
  requestFlattenGroup(groupId: LayerId): void;
  requestFlattenImage(): void;
  editStyles(layerId: LayerId, effectId?: LayerStyleId): void;
  prepareActiveLayerChange?(layerId: LayerId): void;
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
  toggleMask(): void;
  removeMask(layerId?: LayerId): void;
  moveActive(direction: 'up' | 'down'): void;
  setLock(layerIds: LayerId[], lock: keyof LayerLocks, locked: boolean): void;
  createRasterLayer(): void;
  createAdjustmentLayer(): void;
  createLensFxLayer(): void;
  createGroup(): void;
  groupSelection(layerIds: LayerId[]): void;
  ungroupSelection(layerIds: LayerId[]): void;
  deleteSelection(layerIds: LayerId[]): void;
  mergeDown(): void;
  mergeSelected(layerIds: LayerId[]): void;
  flattenGroup(groupId: LayerId): void;
  flattenImage(): void;
  editStyles(layerId: LayerId, effectId?: LayerStyleId): void;
  setStyleStackEnabled(layerId: LayerId, enabled: boolean): void;
  setLocalGradeEnabled(layerId: LayerId, enabled: boolean): void;
  setLocalLensFxEnabled(layerId: LayerId, enabled: boolean): void;
  setStyleEnabled(layerId: LayerId, effectId: LayerStyleId, enabled: boolean): void;
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
    removeMask: (requestedLayerId) => {
      const dependencies = resolveDependencies();
      const layerId = requestedLayerId ?? dependencies.getDocument()?.activeLayerId;
      if (!layerId) return;
      dependencies.mutateDocument((current) =>
        removeLayerMask(current, layerId));
      dependencies.setPaintTarget('pixels');
    },
    moveActive: (direction) => {
      const dependencies = resolveDependencies();
      const document = dependencies.getDocument();
      const layerId = document?.activeLayerId;
      if (!document || !layerId) return;
      const siblings = siblingLayers(document, layerId);
      const activeIndex = siblings.findIndex((layer) => layer.id === layerId);
      const targetIndex = activeIndex + (direction === 'up' ? 1 : -1);
      if (activeIndex < 0 || targetIndex < 0 || targetIndex >= siblings.length) {
        return;
      }
      dependencies.mutateDocument((current) =>
        moveLayer(current, layerId, targetIndex));
    },
    setLock: (layerIds, lock, locked) =>
      mutate((current) => setLayersLock(current, layerIds, lock, locked)),
    createRasterLayer: () =>
      usePixelChannel((current) => createRasterLayer(current)),
    createAdjustmentLayer: () => resolveDependencies().createAdjustmentLayer(),
    createLensFxLayer: () => resolveDependencies().createLensFxLayer(),
    createGroup: () =>
      usePixelChannel((current) => createGroupLayer(current)),
    groupSelection: (layerIds) =>
      usePixelChannel((current) => groupLayers(current, layerIds)),
    ungroupSelection: (layerIds) =>
      usePixelChannel((current) => ungroupLayers(current, layerIds)),
    deleteSelection: (layerIds) =>
      usePixelChannel((current) => deleteLayers(current, layerIds)),
    mergeDown: () => resolveDependencies().mergeActiveLayerDown(),
    mergeSelected: (layerIds) =>
      resolveDependencies().mergeSelectedRasterLayers(layerIds),
    flattenGroup: (groupId) => resolveDependencies().requestFlattenGroup(groupId),
    flattenImage: () => resolveDependencies().requestFlattenImage(),
    editStyles: (layerId, effectId) =>
      resolveDependencies().editStyles(layerId, effectId),
    setStyleStackEnabled: (layerId, enabled) =>
      mutate((current) => setLayerStyleStackEnabled(current, layerId, enabled)),
    setLocalGradeEnabled: (layerId, enabled) =>
      mutate((current) =>
        setRasterLayerAdjustmentStackEnabled(current, layerId, enabled, 'grade')),
    setLocalLensFxEnabled: (layerId, enabled) =>
      mutate((current) =>
        setRasterLayerAdjustmentStackEnabled(current, layerId, enabled, 'lens-fx')),
    setStyleEnabled: (layerId, effectId, enabled) =>
      mutate((current) =>
        setLayerStyleEnabled(current, layerId, effectId, enabled)),
    clearStyles: (layerId) =>
      mutate((current) => clearLayerStyles(current, layerId))
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
