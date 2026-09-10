import type { ImageDocument } from '../../editor/document/documentTypes';
import type {
  DocumentMutationController,
  DocumentMutationTransaction
} from '../documents/useDocumentMutationController';
import { parseCompleteFilterSnapshot, type FilterSnapshot } from './completeFilterSnapshot';
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
  readonly handle: FilterInteractionHandle;
  readonly documentId: ImageDocument['id'];
  readonly target: FilterSnapshotTarget;
  readonly filterKind: FilterSnapshot['kind'];
  readonly renderer: object;
  readonly rendererGeneration: number;
  readonly transaction: DocumentMutationTransaction;
  desiredSnapshot: FilterSnapshot;
  previewGeneration: number;
}

export interface FilterInteractionHandle {
  readonly sequence: number;
}

export interface FilterInteractionSession {
  readonly active: boolean;
  begin(target: FilterSnapshotTarget): FilterInteractionHandle | null;
  currentSnapshot(target: FilterSnapshotTarget,
    handle: FilterInteractionHandle | void): FilterSnapshot | null;
  preview(target: FilterSnapshotTarget, snapshot: FilterSnapshot,
    handle: FilterInteractionHandle | void): boolean;
  commit(handle: FilterInteractionHandle | void): boolean;
  cancel(handle: FilterInteractionHandle | void): boolean;
  cancelActive(): boolean;
  reconcileBinding(expectedTarget?: FilterSnapshotTarget | null): boolean;
}

/** Owns one exact document/filter-owner/renderer-generation Properties gesture. */
export const createFilterInteractionSession = (
  resolveDependencies: () => FilterInteractionSessionDependencies
): FilterInteractionSession => {
  let active: ActiveFilterInteraction | null = null;
  let sequence = 0;
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
  const cancelActive = () => {
    const interaction = active;
    if (!interaction) return false;
    try { return interaction.transaction.cancel(); }
    finally { close(interaction); }
  };
  const begin = (target: FilterSnapshotTarget) => {
    cancelActive();
    const dependencies = resolveDependencies();
    const document = dependencies.getDocument();
    const owner = document ? resolveFilterSnapshotOwner(document, target) : null;
    const renderer = dependencies.getRenderer();
    if (!document || !owner || !renderer) return null;
    let interaction: ActiveFilterInteraction | null = null;
    const transaction = dependencies.documentMutations.begin(
      `filter:${document.id}:${filterSnapshotTargetKey(target)}:${owner.snapshot.kind}`,
      { label: 'Edit Filter', type: 'filter.edit', layerIds: [target.layerId] },
      () => { if (interaction) close(interaction); },
      'cancel'
    );
    if (!transaction) return null;
    const handle = { sequence: ++sequence };
    interaction = {
      handle,
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
    return handle;
  };
  return {
    get active() { return active !== null; },
    begin,
    currentSnapshot: (target, handle) => {
      if (!active || active.handle !== handle
        || filterSnapshotTargetKey(active.target) !== filterSnapshotTargetKey(target)) return null;
      return active.desiredSnapshot;
    },
    preview: (target, snapshot, handle) => {
      const interaction = active;
      if (!interaction || interaction.handle !== handle
        || filterSnapshotTargetKey(interaction.target) !== filterSnapshotTargetKey(target)
        || snapshot.kind !== interaction.filterKind) return false;
      if (!liveOwner(interaction)) {
        cancelActive();
        return false;
      }
      interaction.desiredSnapshot = snapshot;
      interaction.previewGeneration += 1;
      try {
        return interaction.transaction.change(() => applyFilterPreviewSnapshot(
          interaction.transaction.before,
          interaction.target,
          snapshot,
          interaction.previewGeneration
        ));
      } catch (error) {
        cancelActive();
        throw error;
      }
    },
    commit: (handle) => {
      const interaction = active;
      if (!interaction || interaction.handle !== handle) return false;
      if (!liveOwner(interaction)) { cancelActive(); return false; }
      const snapshot = parseCompleteFilterSnapshot(interaction.desiredSnapshot);
      if (!snapshot) {
        cancelActive();
        throw new Error('The filter snapshot is outside its canonical bounds.');
      }
      try {
        interaction.transaction.change(() => applyFilterSnapshot(
          interaction.transaction.before,
          interaction.target,
          snapshot
        ));
      } catch (error) {
        cancelActive();
        throw error;
      }
      const before = interaction.transaction.before;
      const after = interaction.transaction.current;
      try {
        const changed = interaction.transaction.commit();
        if (changed) resolveDependencies().onCheckpoint?.(before, after, interaction.target);
        return changed;
      } finally { close(interaction); }
    },
    cancel: (handle) => active?.handle === handle ? cancelActive() : false,
    cancelActive,
    reconcileBinding: (expectedTarget) => {
      if (!active) return true;
      if (expectedTarget !== undefined
        && (!expectedTarget
          || filterSnapshotTargetKey(active.target) !== filterSnapshotTargetKey(expectedTarget))) {
        cancelActive();
        return false;
      }
      if (liveOwner(active)) return true;
      cancelActive();
      return false;
    }
  };
};
