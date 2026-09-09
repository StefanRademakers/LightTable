import type { ImageDocument } from '../../editor/document/documentTypes';
import type {
  DocumentMutationController,
  DocumentMutationTransaction
} from '../documents/useDocumentMutationController';
import type { FilterSnapshot } from './completeFilterSnapshot';
import {
  applyFilterPreviewSnapshot,
  applyFilterSnapshot,
  filterSnapshotTargetKey,
  resolveFilterSnapshotOwner,
  type FilterSnapshotTarget
} from './filterSnapshotOwner';

export interface FilterInteractionSessionDependencies {
  getDocument(): ImageDocument | null;
  getRenderer(): object | null;
  getRendererGeneration(): number;
  documentMutations: Pick<DocumentMutationController, 'begin'>;
  onCheckpoint?(before: ImageDocument, after: ImageDocument, target: FilterSnapshotTarget): void;
}

interface ActiveFilterInteraction {
  readonly documentId: ImageDocument['id'];
  readonly target: FilterSnapshotTarget;
  readonly filterKind: FilterSnapshot['kind'];
  readonly renderer: object;
  readonly rendererGeneration: number;
  readonly transaction: DocumentMutationTransaction;
  desiredSnapshot: FilterSnapshot;
  previewGeneration: number;
}

export interface FilterInteractionSession {
  readonly active: boolean;
  begin(target: FilterSnapshotTarget): boolean;
  currentSnapshot(target: FilterSnapshotTarget): FilterSnapshot | null;
  preview(target: FilterSnapshotTarget, snapshot: FilterSnapshot): boolean;
  commit(): boolean;
  cancel(): boolean;
  reconcileBinding(): boolean;
}

/** Owns one exact document/filter-owner/renderer-generation Properties gesture. */
export const createFilterInteractionSession = (
  resolveDependencies: () => FilterInteractionSessionDependencies
): FilterInteractionSession => {
  let active: ActiveFilterInteraction | null = null;
  const close = (interaction: ActiveFilterInteraction) => {
    if (active === interaction) active = null;
  };
  const liveOwner = (interaction: ActiveFilterInteraction) => {
    const dependencies = resolveDependencies();
    const document = dependencies.getDocument();
    const owner = document && document.id === interaction.documentId
      ? resolveFilterSnapshotOwner(document, interaction.target)
      : null;
    return Boolean(owner && owner.snapshot.kind === interaction.filterKind
      && dependencies.getRenderer() === interaction.renderer
      && dependencies.getRendererGeneration() === interaction.rendererGeneration
      && interaction.transaction.active);
  };
  const cancel = () => {
    const interaction = active;
    if (!interaction) return false;
    try { return interaction.transaction.cancel(); }
    finally { close(interaction); }
  };
  const begin = (target: FilterSnapshotTarget) => {
    cancel();
    const dependencies = resolveDependencies();
    const document = dependencies.getDocument();
    const owner = document ? resolveFilterSnapshotOwner(document, target) : null;
    const renderer = dependencies.getRenderer();
    if (!document || !owner || !renderer) return false;
    let interaction: ActiveFilterInteraction | null = null;
    const transaction = dependencies.documentMutations.begin(
      `filter:${document.id}:${filterSnapshotTargetKey(target)}:${owner.snapshot.kind}`,
      { label: 'Edit Filter', type: 'filter.edit', layerIds: [target.layerId] },
      () => { if (interaction) close(interaction); },
      'cancel'
    );
    if (!transaction) return false;
    interaction = {
      documentId: document.id,
      target,
      filterKind: owner.snapshot.kind,
      renderer,
      rendererGeneration: dependencies.getRendererGeneration(),
      transaction,
      desiredSnapshot: owner.snapshot,
      previewGeneration: 0
    };
    active = interaction;
    return true;
  };
  return {
    get active() { return active !== null; },
    begin,
    currentSnapshot: (target) => {
      if (!active || filterSnapshotTargetKey(active.target) !== filterSnapshotTargetKey(target)) {
        const document = resolveDependencies().getDocument();
        return document ? resolveFilterSnapshotOwner(document, target)?.snapshot ?? null : null;
      }
      return active.desiredSnapshot;
    },
    preview: (target, snapshot) => {
      if (!active || filterSnapshotTargetKey(active.target) !== filterSnapshotTargetKey(target)) {
        if (!begin(target)) return false;
      }
      const interaction = active;
      if (!interaction || snapshot.kind !== interaction.filterKind || !liveOwner(interaction)) {
        cancel();
        return false;
      }
      interaction.desiredSnapshot = snapshot;
      interaction.previewGeneration += 1;
      return interaction.transaction.change(() => applyFilterPreviewSnapshot(
        interaction.transaction.before,
        interaction.target,
        snapshot,
        interaction.previewGeneration
      ));
    },
    commit: () => {
      const interaction = active;
      if (!interaction) return false;
      if (!liveOwner(interaction)) { cancel(); return false; }
      interaction.transaction.change(() => applyFilterSnapshot(
        interaction.transaction.before,
        interaction.target,
        interaction.desiredSnapshot
      ));
      const before = interaction.transaction.before;
      const after = interaction.transaction.current;
      try {
        const changed = interaction.transaction.commit();
        if (changed) resolveDependencies().onCheckpoint?.(before, after, interaction.target);
        return changed;
      } finally { close(interaction); }
    },
    cancel,
    reconcileBinding: () => {
      if (!active || liveOwner(active)) return true;
      cancel();
      return false;
    }
  };
};
