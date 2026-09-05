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
import type {
  DocumentMutationController,
  DocumentMutationTransaction
} from '../documents/useDocumentMutationController';

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
  readonly documentMutations: Pick<DocumentMutationController, 'begin' | 'change'>;
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
  readonly target: FilterTarget;
  readonly transaction: DocumentMutationTransaction;
}

/** One controller for every global and attached P0 filter Properties view. */
export const useP0FilterController = ({
  document,
  target,
  getDocument,
  documentMutations
}: Dependencies): { readonly model: P0FilterPresentation | null; readonly commands: P0FilterCommands } => {
  const dependenciesRef = useRef({
    getDocument,
    documentMutations
  });
  dependenciesRef.current = {
    getDocument,
    documentMutations
  };
  const targetRef = useRef(target);
  targetRef.current = target;
  const transaction = useRef<ActiveFilterTransaction | null>(null);
  const resolved = resolveTarget(document, target);

  const cancelAdjustment = useCallback(() => {
    const active = transaction.current;
    transaction.current = null;
    active?.transaction.cancel();
  }, []);

  const endAdjustment = useCallback(() => {
    const completed = transaction.current;
    if (!completed) return;
    transaction.current = null;
    completed.transaction.commit({ label: 'Edit Filter', type: 'filter.edit' });
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
    if (active && (active.transaction.documentId !== current.id
      || !active.transaction.active
      || targetKey(active.target) !== targetKey(currentTarget))) {
      cancelAdjustment();
    }
    if (!transaction.current) {
      const documentTransaction = dependenciesRef.current.documentMutations.begin(
        `filter:${targetKey(currentTarget)}`,
        { label: 'Edit Filter', type: 'filter.edit' }
      );
      if (!documentTransaction) return null;
      transaction.current = { target: currentTarget, transaction: documentTransaction };
    }
    return transaction.current;
  }, [cancelAdjustment]);

  const updateSetting = useCallback((key: string, value: unknown) => {
    const active = ensureTransaction();
    if (!active) return;
    const baselineTarget = resolveTarget(active.transaction.current, targetRef.current);
    if (!baselineTarget || targetKey(baselineTarget.target) !== targetKey(active.target)) {
      cancelAdjustment();
      return;
    }
    const patch = settingPatch(baselineTarget.settings, key, value);
    active.transaction.change((current) => setSettings(current, active.target, patch));
  }, [cancelAdjustment, ensureTransaction]);

  const commit = useCallback((mutate: (source: ImageDocument, target: FilterTarget) => ImageDocument) => {
    cancelAdjustment();
    const dependencies = dependenciesRef.current;
    dependencies.documentMutations.change((current) => {
      const currentTarget = resolveTarget(current, targetRef.current)?.target ?? null;
      return currentTarget ? mutate(current, currentTarget) : current;
    });
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
