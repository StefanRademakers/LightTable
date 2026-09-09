import type {
  ImageDocument,
  LayerId
} from '../../editor/document/documentTypes';
import { layerIsLocked } from '../../editor/document/documentTypes';
import { findDocumentLayer, updateLayerNode } from '../../editor/document/layerTree';
import {
  setAdjustmentLayerStack,
  setRasterLayerAttachedAdjustmentEnabled,
  setRasterLayerAttachedAdjustmentStack
} from '../../editor/document/documentCommands';
import type { AdjustmentStack } from '../../processing/adjustmentStack';
import { filterKindForStack, filterModule, filterSettings } from '../../processing/filter';
import {
  filterSnapshot,
  filterSnapshotValuesEqual,
  type FilterSnapshot
} from './completeFilterSnapshot';
import { filterDocumentReferenceError } from './filterDocumentReferences';

export type FilterSnapshotTarget =
  | { readonly kind: 'layer'; readonly layerId: LayerId }
  | { readonly kind: 'attached'; readonly layerId: LayerId; readonly adjustmentId: string };

export interface ResolvedFilterSnapshotOwner {
  readonly target: FilterSnapshotTarget;
  readonly stack: AdjustmentStack;
  readonly snapshot: FilterSnapshot;
}

export const filterSnapshotTargetKey = (target: FilterSnapshotTarget) => (
  target.kind === 'attached'
    ? `attached:${target.layerId}:${target.adjustmentId}`
    : `layer:${target.layerId}`
);

export const resolveFilterSnapshotOwner = (
  document: ImageDocument,
  target: FilterSnapshotTarget
): ResolvedFilterSnapshotOwner | null => {
  const layer = findDocumentLayer(document, target.layerId);
  if (!layer || layerIsLocked(layer, 'pixels')) return null;
  if (target.kind === 'attached') {
    if (layer.type !== 'raster') return null;
    const adjustment = (layer.attachedAdjustments ?? [])
      .find(({ id }) => id === target.adjustmentId);
    if (!adjustment) return null;
    const module = filterModule(adjustment.adjustmentStack);
    const kind = filterKindForStack(adjustment.adjustmentStack);
    if (!kind || adjustment.adjustmentKind !== kind) return null;
    const settings = filterSettings(adjustment.adjustmentStack, kind);
    return module && settings ? {
      target,
      stack: adjustment.adjustmentStack,
      snapshot: filterSnapshot(kind, adjustment.enabled, settings)
    } : null;
  }
  if (layer.type !== 'adjustment') return null;
  const module = filterModule(layer.adjustmentStack);
  const kind = filterKindForStack(layer.adjustmentStack);
  if (!kind || layer.adjustmentKind !== kind) return null;
  const settings = filterSettings(layer.adjustmentStack, kind);
  return module && settings ? {
    target,
    stack: layer.adjustmentStack,
    snapshot: filterSnapshot(kind, module.enabled, settings)
  } : null;
};

const stackWithSnapshot = (
  owner: ResolvedFilterSnapshotOwner,
  snapshot: FilterSnapshot
): AdjustmentStack => ({
  ...owner.stack,
  revision: owner.stack.revision + 1,
  modules: owner.stack.modules.map((module) => {
    const current = filterModule(owner.stack);
    if (module.id !== current?.id) return module;
    return {
      ...module,
      enabled: owner.target.kind === 'layer' ? snapshot.enabled : module.enabled,
      revision: module.revision + 1,
      settings: structuredClone(snapshot.settings)
    };
  })
});

export const applyFilterSnapshot = (
  document: ImageDocument,
  target: FilterSnapshotTarget,
  snapshot: FilterSnapshot
): ImageDocument => {
  const owner = resolveFilterSnapshotOwner(document, target);
  if (!owner) throw new Error('The filter owner does not exist or is locked.');
  if (owner.snapshot.kind !== snapshot.kind) {
    throw new Error('The filter snapshot kind does not match its owner.');
  }
  const referenceError = filterDocumentReferenceError(document, snapshot.kind, snapshot.settings);
  if (referenceError) throw new Error(referenceError);
  if (filterSnapshotValuesEqual(owner.snapshot, snapshot)) return document;
  const settingsChanged = !filterSnapshotValuesEqual(owner.snapshot.settings, snapshot.settings);
  const moduleEnabledChanged = target.kind === 'layer'
    && owner.snapshot.enabled !== snapshot.enabled;
  const nextStack = settingsChanged || moduleEnabledChanged
    ? stackWithSnapshot(owner, snapshot)
    : owner.stack;
  if (target.kind === 'layer') {
    return setAdjustmentLayerStack(document, target.layerId, nextStack);
  }
  const withStack = nextStack === owner.stack ? document : setRasterLayerAttachedAdjustmentStack(
    document, target.layerId, target.adjustmentId, nextStack
  );
  return setRasterLayerAttachedAdjustmentEnabled(
    withStack, target.layerId, target.adjustmentId, snapshot.enabled
  );
};

/** Builds a disposable projection with a pointer-sample generation that is never persisted. */
export const applyFilterPreviewSnapshot = (
  before: ImageDocument,
  target: FilterSnapshotTarget,
  snapshot: FilterSnapshot,
  previewGeneration: number
): ImageDocument => {
  const sourceOwner = resolveFilterSnapshotOwner(before, target);
  if (!sourceOwner || previewGeneration < 1) {
    throw new Error('A filter preview requires a live owner and positive generation.');
  }
  const projected = applyFilterSnapshot(before, target, snapshot);
  const projectedOwner = resolveFilterSnapshotOwner(projected, target);
  if (!projectedOwner) throw new Error('The projected filter owner could not be resolved.');
  const sourceModule = filterModule(sourceOwner.stack);
  const projectedModule = filterModule(projectedOwner.stack);
  if (!sourceModule || !projectedModule) throw new Error('The filter module could not be resolved.');
  const adjustmentStack: AdjustmentStack = {
    ...projectedOwner.stack,
    revision: sourceOwner.stack.revision + previewGeneration,
    modules: projectedOwner.stack.modules.map((module) => module.id === projectedModule.id
      ? { ...module, revision: sourceModule.revision + previewGeneration }
      : module)
  };
  const layers = updateLayerNode(projected.layers, target.layerId, (layer) => {
    const sourceLayer = findDocumentLayer(before, target.layerId);
    if (!sourceLayer) return layer;
    if (target.kind === 'layer' && layer.type === 'adjustment') return {
      ...layer,
      adjustmentStack,
      revision: sourceLayer.revision + previewGeneration
    };
    if (target.kind !== 'attached' || layer.type !== 'raster' || sourceLayer.type !== 'raster') {
      return layer;
    }
    const sourceAdjustment = (sourceLayer.attachedAdjustments ?? [])
      .find(({ id }) => id === target.adjustmentId);
    if (!sourceAdjustment) return layer;
    return {
      ...layer,
      revision: sourceLayer.revision + previewGeneration,
      attachedAdjustments: (layer.attachedAdjustments ?? []).map((adjustment) => (
        adjustment.id === target.adjustmentId
          ? { ...adjustment, adjustmentStack,
            revision: sourceAdjustment.revision + previewGeneration }
          : adjustment
      ))
    };
  });
  return { ...projected, layers, revision: before.revision + previewGeneration };
};
