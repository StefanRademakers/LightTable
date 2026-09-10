import { useCallback, useEffect, useRef } from 'react';
import {
  defaultFilterSettings,
  filterDefinition,
  normalizeFilterSettings,
  type FilterKind,
  type FilterSettingsMap
} from '@lighttable/filter-core';
import type { ImageDocument } from '../../editor/document/documentTypes';
import { findDocumentLayer, walkRasterLayers } from '../../editor/document/layerTree';
import type { PropertiesInspectorTarget } from '../properties/propertiesInspectorTarget';
import type { DocumentMutationController } from '../documents/useDocumentMutationController';
import { filterSnapshot } from './completeFilterSnapshot';
import { executeSemanticFilterSnapshot } from './executeSemanticFilterSnapshot';
import {
  createFilterInteractionSession,
  type FilterInteractionHandle,
  type FilterInteractionSession
} from './filterInteractionSession';
import {
  resolveFilterSnapshotOwner,
  type FilterSnapshotTarget
} from './filterSnapshotOwner';
import {
  admittedHandle,
  admittedInteraction,
  rejectedInteraction,
  type InteractionAdmission
} from '../interactions/interactionAdmission';

export type FilterInteractionAdmission = InteractionAdmission<FilterInteractionHandle>;

export interface P0FilterPresentation {
  readonly kind: FilterKind;
  readonly label: string;
  readonly settings: FilterSettingsMap[FilterKind];
  readonly enabled: boolean;
  readonly rasterSources: readonly { readonly value: string; readonly label: string }[];
}

export interface P0FilterCommands {
  readonly beginAdjustment: () => FilterInteractionAdmission;
  readonly endAdjustment: (admission: FilterInteractionAdmission) => void;
  readonly cancelAdjustment: (admission: FilterInteractionAdmission) => void;
  readonly updateSetting: (key: string, value: unknown,
    admission: FilterInteractionAdmission) => void;
  readonly reset: () => void;
  readonly toggleEnabled: () => void;
}

interface Dependencies {
  readonly document: ImageDocument | null;
  readonly target: PropertiesInspectorTarget;
  readonly getDocument: () => ImageDocument | null;
  readonly getRenderer: () => object | null;
  readonly documentMutations: Pick<DocumentMutationController, 'begin' | 'change'>;
  readonly rendererGeneration: number;
  readonly onCheckpoint?: (
    before: ImageDocument,
    after: ImageDocument,
    target: FilterSnapshotTarget
  ) => void;
}

const resolveTarget = (
  document: ImageDocument | null,
  inspectorTarget: PropertiesInspectorTarget
): FilterSnapshotTarget | null => {
  if (!document) return null;
  if (inspectorTarget.kind === 'attached-processing') {
    return resolveFilterSnapshotOwner(document, {
      kind: 'attached',
      layerId: inspectorTarget.layerId,
      adjustmentId: inspectorTarget.adjustmentId
    })?.target ?? null;
  }
  const layer = findDocumentLayer(document, document.activeLayerId);
  if (layer?.type !== 'adjustment') return null;
  return resolveFilterSnapshotOwner(document, {
    kind: 'layer',
    layerId: layer.id
  })?.target ?? null;
};

const settingPatch = (settings: unknown, path: string, value: unknown): Record<string, unknown> => {
  const [root, ...parts] = path.split('.');
  if (parts.length === 0) return { [root]: value };
  const source = settings && typeof settings === 'object'
    ? (settings as Record<string, unknown>)[root]
    : undefined;
  const branch = structuredClone(source ?? {});
  let owner = branch as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) {
    const next = owner[part];
    if (!next || typeof next !== 'object' || Array.isArray(next)) owner[part] = {};
    owner = owner[part] as Record<string, unknown>;
  }
  owner[parts.at(-1)!] = value;
  return { [root]: branch };
};

/** One document-bound interaction controller for every filter Properties view. */
export const useP0FilterController = ({
  document,
  target,
  getDocument,
  getRenderer,
  documentMutations,
  rendererGeneration,
  onCheckpoint
}: Dependencies): { readonly model: P0FilterPresentation | null; readonly commands: P0FilterCommands } => {
  const dependenciesRef = useRef({
    getDocument,
    getRenderer,
    documentMutations,
    rendererGeneration,
    onCheckpoint
  });
  dependenciesRef.current = {
    getDocument,
    getRenderer,
    documentMutations,
    rendererGeneration,
    onCheckpoint
  };
  const targetRef = useRef(target);
  targetRef.current = target;
  const sessionRef = useRef<FilterInteractionSession | null>(null);
  if (!sessionRef.current) {
    sessionRef.current = createFilterInteractionSession(() => ({
      getDocument: dependenciesRef.current.getDocument,
      getRenderer: dependenciesRef.current.getRenderer,
      getRendererGeneration: () => dependenciesRef.current.rendererGeneration,
      documentMutations: dependenciesRef.current.documentMutations,
      onCheckpoint: dependenciesRef.current.onCheckpoint
    }));
  }
  const session = sessionRef.current;
  const resolvedTarget = resolveTarget(document, target);
  const resolvedOwner = resolvedTarget && document
    ? resolveFilterSnapshotOwner(document, resolvedTarget)
    : null;

  const cancelAdjustment = useCallback((admission: FilterInteractionAdmission) => {
    const handle = admittedHandle(admission);
    if (handle) session.cancel(handle);
  }, [session]);
  const endAdjustment = useCallback((admission: FilterInteractionAdmission) => {
    const handle = admittedHandle(admission);
    if (handle) session.commit(handle);
  }, [session]);
  const resolvedTargetKey = resolvedTarget?.kind === 'attached'
    ? `${resolvedTarget.kind}:${resolvedTarget.layerId}:${resolvedTarget.adjustmentId}`
    : resolvedTarget ? `${resolvedTarget.kind}:${resolvedTarget.layerId}` : null;
  useEffect(() => {
    session.reconcileBinding(resolvedTarget);
  }, [session, document?.id, document?.revision, rendererGeneration, resolvedTargetKey]);
  useEffect(() => () => { session.cancelActive(); }, [session]);

  const currentTarget = useCallback(() => (
    resolveTarget(dependenciesRef.current.getDocument(), targetRef.current)
  ), []);

  const updateSetting = useCallback((key: string, value: unknown,
    admission: FilterInteractionAdmission) => {
    const commandTarget = currentTarget();
    if (!commandTarget) return;
    const handle = admittedHandle(admission);
    if (!handle) return;
    const current = session.currentSnapshot(commandTarget, handle);
    if (!current) return;
    const settings = normalizeFilterSettings(current.kind, {
      ...current.settings,
      ...settingPatch(current.settings, key, value)
    });
    session.preview(
      commandTarget, filterSnapshot(current.kind, current.enabled, settings), handle
    );
  }, [currentTarget, session]);

  const commitSnapshot = useCallback((createSnapshot: (
    owner: NonNullable<ReturnType<typeof resolveFilterSnapshotOwner>>
  ) => ReturnType<typeof filterSnapshot>) => {
    session.cancelActive();
    const dependencies = dependenciesRef.current;
    const before = dependencies.getDocument();
    const commandTarget = currentTarget();
    if (!before || !commandTarget) return;
    const owner = resolveFilterSnapshotOwner(before, commandTarget);
    if (!owner) return;
    const result = executeSemanticFilterSnapshot({
      target: commandTarget,
      snapshot: createSnapshot(owner)
    }, { changeDocument: dependencies.documentMutations.change });
    const after = dependencies.getDocument();
    if (result.changed && after && before !== after) {
      dependencies.onCheckpoint?.(before, after, commandTarget);
    }
  }, [currentTarget, session]);

  const model = resolvedOwner ? {
    kind: resolvedOwner.snapshot.kind,
    label: filterDefinition(resolvedOwner.snapshot.kind).label,
    settings: resolvedOwner.snapshot.settings,
    enabled: resolvedOwner.snapshot.enabled,
    rasterSources: document ? walkRasterLayers(document.layers).map(({ layer, ancestors }) => ({
      value: layer.id,
      label: [...ancestors.map(({ name }) => name), layer.name].join(' / ')
    })) : []
  } : null;

  return { model, commands: {
    beginAdjustment: () => {
      const commandTarget = currentTarget();
      const handle = commandTarget ? session.begin(commandTarget) : null;
      return handle
        ? admittedInteraction(handle)
        : rejectedInteraction<FilterInteractionHandle>();
    },
    endAdjustment,
    cancelAdjustment,
    updateSetting,
    reset: () => commitSnapshot((owner) => filterSnapshot(
      owner.snapshot.kind,
      owner.snapshot.enabled,
      defaultFilterSettings(owner.snapshot.kind)
    )),
    toggleEnabled: () => commitSnapshot((owner) => filterSnapshot(
      owner.snapshot.kind,
      !owner.snapshot.enabled,
      owner.snapshot.settings
    ))
  } };
};
