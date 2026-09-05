import { useCallback, useEffect, useRef } from 'react';
import {
  defaultFilterSettings,
  filterDefinition,
  isFilterKind,
  type FilterKind,
  type FilterSettingsMap
} from '@lighttable/filter-core';
import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { findDocumentLayer, walkRasterLayers } from '../../editor/document/layerTree';
import {
  setP0FilterLayerEnabled,
  setP0FilterLayerSettings,
  setRasterLayerAttachedAdjustmentEnabled,
  setRasterLayerAttachedAdjustmentStack
} from '../../editor/document/documentCommands';
import { filterModule, filterSettings, setFilterSettings } from '../../processing/filter';
import type { PropertiesInspectorTarget } from '../properties/propertiesInspectorTarget';

export interface P0FilterPresentation {
  readonly kind: FilterKind;
  readonly label: string;
  readonly settings: FilterSettingsMap[FilterKind];
  readonly enabled: boolean;
  readonly rasterSources: readonly { readonly value: string; readonly label: string }[];
}

export interface P0FilterCommands {
  readonly beginAdjustment: () => void;
  readonly endAdjustment: () => void;
  readonly cancelAdjustment: () => void;
  readonly updateSetting: (key: string, value: unknown) => void;
  readonly reset: () => void;
  readonly toggleEnabled: () => void;
}

interface Dependencies {
  readonly document: ImageDocument | null;
  readonly target: PropertiesInspectorTarget;
  readonly getDocument: () => ImageDocument | null;
  readonly applyDocument: (document: ImageDocument) => void;
  readonly previewDocument: (document: ImageDocument) => void;
  readonly discardDocumentPreview: () => void;
  readonly recordHistory: (before: ImageDocument, after: ImageDocument) => void;
}

type FilterTarget =
  | { readonly placement: 'adjustment-layer'; readonly layerId: LayerId; readonly kind: FilterKind }
  | { readonly placement: 'attached'; readonly layerId: LayerId; readonly adjustmentId: string;
      readonly kind: FilterKind };

const resolveTarget = (document: ImageDocument | null, inspectorTarget: PropertiesInspectorTarget) => {
  if (!document) return null;
  if (inspectorTarget.kind === 'attached-processing') {
    const layer = findDocumentLayer(document, inspectorTarget.layerId);
    const adjustment = layer?.type === 'raster'
      ? (layer.attachedAdjustments ?? []).find(({ id }) => id === inspectorTarget.adjustmentId)
      : null;
    if (!adjustment || !isFilterKind(adjustment.adjustmentKind)) return null;
    const module = filterModule(adjustment.adjustmentStack, adjustment.adjustmentKind);
    const settings = filterSettings(adjustment.adjustmentStack, adjustment.adjustmentKind);
    return module && settings ? {
      target: {
        placement: 'attached' as const, layerId: layer!.id, adjustmentId: adjustment.id,
        kind: adjustment.adjustmentKind
      },
      settings,
      enabled: adjustment.enabled
    } : null;
  }
  const layer = findDocumentLayer(document, document.activeLayerId);
  if (layer?.type !== 'adjustment' || !isFilterKind(layer.adjustmentKind)) return null;
  const module = filterModule(layer.adjustmentStack, layer.adjustmentKind);
  const settings = filterSettings(layer.adjustmentStack, layer.adjustmentKind);
  return module && settings ? {
    target: { placement: 'adjustment-layer' as const, layerId: layer.id, kind: layer.adjustmentKind },
    settings,
    enabled: module.enabled
  } : null;
};

const targetKey = (target: FilterTarget) => target.placement === 'attached'
  ? `${target.layerId}::${target.adjustmentId}` : target.layerId;

const settingPatch = (settings: unknown, path: string, value: unknown): Record<string, unknown> => {
  const [root, ...parts] = path.split('.');
  if (parts.length === 0) return { [root]: value };
  const source = settings && typeof settings === 'object'
    ? (settings as Record<string, unknown>)[root]
    : undefined;
  const branch = structuredClone(source ?? {});
  let owner = branch as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) {
    owner = owner[part] as Record<string, unknown>;
  }
  owner[parts.at(-1)!] = value;
  return { [root]: branch };
};

const setSettings = (
  document: ImageDocument, target: FilterTarget, patch: Record<string, unknown>
) => {
  if (target.placement === 'adjustment-layer') {
    return setP0FilterLayerSettings(document, target.layerId, target.kind, patch);
  }
  const layer = findDocumentLayer(document, target.layerId);
  const adjustment = layer?.type === 'raster'
    ? (layer.attachedAdjustments ?? []).find(({ id }) => id === target.adjustmentId)
    : null;
  if (!adjustment || adjustment.adjustmentKind !== target.kind) return document;
  const stack = setFilterSettings(adjustment.adjustmentStack, target.kind, patch);
  return stack === adjustment.adjustmentStack ? document : setRasterLayerAttachedAdjustmentStack(
    document, target.layerId, target.adjustmentId, stack
  );
};

const setEnabled = (
  document: ImageDocument, target: FilterTarget, enabled: boolean
) => target.placement === 'adjustment-layer'
  ? setP0FilterLayerEnabled(document, target.layerId, target.kind, enabled)
  : setRasterLayerAttachedAdjustmentEnabled(document, target.layerId, target.adjustmentId, enabled);

interface ActiveFilterTransaction {
  readonly before: ImageDocument;
  readonly target: FilterTarget;
  latest: ImageDocument | null;
}

/** One controller for every global and attached P0 filter Properties view. */
export const useP0FilterController = ({
  document,
  target,
  getDocument,
  applyDocument,
  previewDocument,
  discardDocumentPreview,
  recordHistory
}: Dependencies): { readonly model: P0FilterPresentation | null; readonly commands: P0FilterCommands } => {
  const dependenciesRef = useRef({
    getDocument,
    applyDocument,
    previewDocument,
    discardDocumentPreview,
    recordHistory
  });
  dependenciesRef.current = {
    getDocument,
    applyDocument,
    previewDocument,
    discardDocumentPreview,
    recordHistory
  };
  const targetRef = useRef(target);
  targetRef.current = target;
  const transaction = useRef<ActiveFilterTransaction | null>(null);
  const resolved = resolveTarget(document, target);

  const cancelAdjustment = useCallback(() => {
    if (!transaction.current) return;
    transaction.current = null;
    dependenciesRef.current.discardDocumentPreview();
  }, []);

  const endAdjustment = useCallback(() => {
    const completed = transaction.current;
    if (!completed) return;
    transaction.current = null;
    const dependencies = dependenciesRef.current;
    const current = dependencies.getDocument();
    const canonicalIsBaseline = current?.id === completed.before.id
      && current.revision === completed.before.revision;
    const after = completed.latest;
    if (!canonicalIsBaseline || !after || after === completed.before) {
      dependencies.discardDocumentPreview();
      return;
    }
    try {
      dependencies.applyDocument(after);
      dependencies.recordHistory(completed.before, after);
    } catch (error) {
      dependencies.applyDocument(completed.before);
      throw error;
    }
  }, []);

  const resolvedTargetKey = resolved ? targetKey(resolved.target) : null;
  useEffect(() => () => {
    cancelAdjustment();
  }, [cancelAdjustment, document?.id, document?.revision, resolvedTargetKey]);

  const ensureTransaction = useCallback(() => {
    const current = dependenciesRef.current.getDocument();
    const currentTarget = resolveTarget(current, targetRef.current)?.target ?? null;
    if (!current || !currentTarget) return null;
    const active = transaction.current;
    if (active && (active.before.id !== current.id
      || active.before.revision !== current.revision
      || targetKey(active.target) !== targetKey(currentTarget))) {
      cancelAdjustment();
    }
    transaction.current ??= { before: current, target: currentTarget, latest: null };
    return transaction.current;
  }, [cancelAdjustment]);

  const updateSetting = useCallback((key: string, value: unknown) => {
    const active = ensureTransaction();
    if (!active) return;
    const baselineTarget = resolveTarget(active.before, targetRef.current);
    if (!baselineTarget || targetKey(baselineTarget.target) !== targetKey(active.target)) {
      cancelAdjustment();
      return;
    }
    const patch = settingPatch(baselineTarget.settings, key, value);
    const next = setSettings(active.before, active.target, patch);
    active.latest = next === active.before ? null : next;
    if (active.latest) {
      dependenciesRef.current.previewDocument(active.latest);
    } else {
      dependenciesRef.current.discardDocumentPreview();
    }
  }, [cancelAdjustment, ensureTransaction]);

  const commit = useCallback((mutate: (source: ImageDocument, target: FilterTarget) => ImageDocument) => {
    cancelAdjustment();
    const dependencies = dependenciesRef.current;
    const current = dependencies.getDocument();
    const currentTarget = resolveTarget(current, targetRef.current)?.target ?? null;
    if (!current || !currentTarget) return;
    const next = mutate(current, currentTarget);
    if (next === current) return;
    try {
      dependencies.applyDocument(next);
      dependencies.recordHistory(current, next);
    } catch (error) {
      dependencies.applyDocument(current);
      throw error;
    }
  }, [cancelAdjustment]);

  const model = resolved ? {
    kind: resolved.target.kind,
    label: filterDefinition(resolved.target.kind).label,
    settings: resolved.settings,
    enabled: resolved.enabled,
    rasterSources: document ? walkRasterLayers(document.layers).map(({ layer, ancestors }) => ({
      value: layer.id,
      label: [...ancestors.map(({ name }) => name), layer.name].join(' / ')
    })) : []
  } : null;

  return { model, commands: {
    beginAdjustment: () => { ensureTransaction(); },
    endAdjustment,
    cancelAdjustment,
    updateSetting,
    reset: () => commit((source, filterTarget) => setSettings(
      source, filterTarget, defaultFilterSettings(filterTarget.kind)
    )),
    toggleEnabled: () => commit((source, filterTarget) => {
      const enabled = resolveTarget(source, targetRef.current)?.enabled;
      return typeof enabled === 'boolean'
        ? setEnabled(source, filterTarget, !enabled)
        : source;
    })
  } };
};
