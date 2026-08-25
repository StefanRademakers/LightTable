import { useCallback, useRef } from 'react';
import {
  defaultP0FilterSettings,
  isP0FilterKind,
  p0FilterDefinition,
  type P0FilterKind,
  type P0FilterSettings
} from '@lighttable/filter-core';
import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { findDocumentLayer, walkRasterLayers } from '../../editor/document/layerTree';
import {
  setP0FilterLayerEnabled,
  setP0FilterLayerSettings,
  setRasterLayerAttachedAdjustmentEnabled,
  setRasterLayerAttachedAdjustmentStack
} from '../../editor/document/documentCommands';
import { p0FilterModule, p0FilterSettings, setP0FilterSettings } from '../../processing/p0Filter';
import type { PropertiesInspectorTarget } from '../properties/propertiesInspectorTarget';

export interface P0FilterPresentation {
  readonly kind: P0FilterKind;
  readonly label: string;
  readonly settings: P0FilterSettings;
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
  | { readonly placement: 'adjustment-layer'; readonly layerId: LayerId; readonly kind: P0FilterKind }
  | { readonly placement: 'attached'; readonly layerId: LayerId; readonly adjustmentId: string;
      readonly kind: P0FilterKind };

const resolveTarget = (document: ImageDocument | null, inspectorTarget: PropertiesInspectorTarget) => {
  if (!document) return null;
  if (inspectorTarget.kind === 'attached-processing') {
    const layer = findDocumentLayer(document, inspectorTarget.layerId);
    const adjustment = layer?.type === 'raster'
      ? (layer.attachedAdjustments ?? []).find(({ id }) => id === inspectorTarget.adjustmentId)
      : null;
    if (!adjustment || !isP0FilterKind(adjustment.adjustmentKind)) return null;
    const module = p0FilterModule(adjustment.adjustmentStack, adjustment.adjustmentKind);
    const settings = p0FilterSettings(adjustment.adjustmentStack, adjustment.adjustmentKind);
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
  if (layer?.type !== 'adjustment' || !isP0FilterKind(layer.adjustmentKind)) return null;
  const module = p0FilterModule(layer.adjustmentStack, layer.adjustmentKind);
  const settings = p0FilterSettings(layer.adjustmentStack, layer.adjustmentKind);
  return module && settings ? {
    target: { placement: 'adjustment-layer' as const, layerId: layer.id, kind: layer.adjustmentKind },
    settings,
    enabled: module.enabled
  } : null;
};

const targetKey = (target: FilterTarget) => target.placement === 'attached'
  ? `${target.layerId}::${target.adjustmentId}` : target.layerId;

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
  const stack = setP0FilterSettings(adjustment.adjustmentStack, target.kind, patch);
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
    const next = setSettings(current, resolved.target, { [key]: value });
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
    label: p0FilterDefinition(resolved.target.kind).label,
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
      source, filterTarget, defaultP0FilterSettings(filterTarget.kind)
    )),
    toggleEnabled: () => commit((source, filterTarget) =>
      setEnabled(source, filterTarget, !resolved?.enabled))
  } };
};
