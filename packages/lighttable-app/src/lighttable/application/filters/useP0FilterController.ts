import { useCallback, useRef } from 'react';
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
  readonly updateSetting: (key: string, value: unknown) => void;
  readonly reset: () => void;
  readonly toggleEnabled: () => void;
}

interface Dependencies {
  readonly document: ImageDocument | null;
  readonly target: PropertiesInspectorTarget;
  readonly getDocument: () => ImageDocument | null;
  readonly applyDocument: (document: ImageDocument) => void;
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

/** One controller for every global and attached P0 filter Properties view. */
export const useP0FilterController = ({
  document, target, getDocument, applyDocument, recordHistory
}: Dependencies): { readonly model: P0FilterPresentation | null; readonly commands: P0FilterCommands } => {
  const transaction = useRef<{ readonly before: ImageDocument; readonly target: FilterTarget;
    lastApplied: ImageDocument } | null>(null);
  const resolved = resolveTarget(document, target);

  const finish = useCallback(() => {
    const completed = transaction.current;
    transaction.current = null;
    if (completed && completed.before !== completed.lastApplied) {
      recordHistory(completed.before, completed.lastApplied);
    }
  }, [recordHistory]);

  const ensureTransaction = useCallback(() => {
    const current = getDocument();
    if (!current || !resolved) return null;
    if (transaction.current && targetKey(transaction.current.target) !== targetKey(resolved.target)) {
      finish();
    }
    transaction.current ??= { before: current, target: resolved.target, lastApplied: current };
    return current;
  }, [finish, getDocument, resolved]);

  const updateSetting = useCallback((key: string, value: unknown) => {
    const current = ensureTransaction();
    if (!current || !resolved || !transaction.current) return;
    const patch = settingPatch(resolved.settings, key, value);
    const next = setSettings(current, resolved.target, patch);
    if (next !== current) {
      transaction.current.lastApplied = next;
      applyDocument(next);
    }
  }, [applyDocument, ensureTransaction, resolved]);

  const commit = useCallback((mutate: (source: ImageDocument, target: FilterTarget) => ImageDocument) => {
    const current = getDocument();
    if (!current || !resolved) return;
    finish();
    const next = mutate(current, resolved.target);
    if (next === current) return;
    applyDocument(next);
    recordHistory(current, next);
  }, [applyDocument, finish, getDocument, recordHistory, resolved]);

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
    endAdjustment: finish,
    updateSetting,
    reset: () => commit((source, filterTarget) => setSettings(
      source, filterTarget, defaultFilterSettings(filterTarget.kind)
    )),
    toggleEnabled: () => commit((source, filterTarget) =>
      setEnabled(source, filterTarget, !resolved?.enabled))
  } };
};
