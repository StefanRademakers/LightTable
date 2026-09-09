import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import type { ReversiblePixelEdit } from '../../editor/history/ReversiblePixelEdit';
import { AppliedPixelMutationCoordinator } from '@lighttable/editor-kernel';

export interface PixelMutationHistoryEntry {
  readonly label: string;
  readonly type: string;
  byteSize: number;
  layerIds: readonly LayerId[];
  undo(): void;
  redo(): void;
  dispose(): void;
}

export interface PixelMutationTransactionDependencies {
  getRenderer(): {
    applyPixelHistory(edit: ReversiblePixelEdit, direction: 'undo' | 'redo'): boolean;
  } | null;
  applyDocumentSnapshot(document: ImageDocument): void;
  pushHistoryEntry(entry: PixelMutationHistoryEntry): void;
}

export type UnpublishedPixelEditApplier = (
  edit: ReversiblePixelEdit,
  direction: 'undo' | 'redo'
) => boolean;

export interface UnpublishedPixelRollbackOutcome {
  readonly ok: boolean;
  readonly compensationFailed: boolean;
}

/** Retains recovery snapshots until an unpublished GPU mutation is fully reversed. */
export class UnpublishedPixelRollbackOwner {
  private pending: {
    readonly apply: UnpublishedPixelEditApplier;
    readonly edits: Array<{ readonly edit: ReversiblePixelEdit; applied: boolean }>;
  } | null = null;

  get blocked() { return this.pending !== null; }

  rollback(
    apply: UnpublishedPixelEditApplier,
    edits: readonly ReversiblePixelEdit[]
  ): UnpublishedPixelRollbackOutcome {
    if (this.pending) return { ok: false, compensationFailed: true };
    this.pending = { apply, edits: edits.map((edit) => ({ edit, applied: true })) };
    return this.retry()!;
  }

  retry(): UnpublishedPixelRollbackOutcome | null {
    const pending = this.pending;
    if (!pending) return null;
    const applySafely = (
      state: (typeof pending.edits)[number],
      direction: 'undo' | 'redo'
    ) => {
      try {
        const applied = pending.apply(state.edit, direction);
        if (applied) state.applied = direction === 'redo';
        return applied;
      } catch {
        return false;
      }
    };

    // A previous compensation may have stopped halfway. Restore the known
    // all-applied side first; only that state is a valid rollback precondition.
    for (const state of pending.edits) {
      if (!state.applied && !applySafely(state, 'redo')) {
        return { ok: false, compensationFailed: true };
      }
    }

    for (let index = pending.edits.length - 1; index >= 0; index -= 1) {
      const state = pending.edits[index]!;
      if (!applySafely(state, 'undo')) {
      let compensationFailed = false;
        for (const restore of pending.edits) {
          if (!restore.applied && !applySafely(restore, 'redo')) compensationFailed = true;
        }
        return { ok: false, compensationFailed };
      }
    }

    pending.edits.forEach(({ edit }) => edit.destroy());
    this.pending = null;
    return { ok: true, compensationFailed: false };
  }
}

export interface CommitAppliedPixelMutation {
  readonly operation: string;
  readonly label: string;
  readonly type: string;
  readonly layerIds: readonly LayerId[];
  readonly before: ImageDocument;
  /** Document state required before GPU undo can address a removed target. */
  readonly undoBase?: ImageDocument;
  /**
   * Optional document state that must exist before GPU redo can address its
   * target (for example a newly-created layer mask).
   */
  readonly redoBase?: ImageDocument;
  readonly after: ImageDocument;
  /** Edits in their forward application order. */
  readonly edits: readonly ReversiblePixelEdit[];
  /** Runtime bytes retained by history outside the reversible edit snapshots. */
  readonly retainedByteSize?: number;
}

/**
 * Transfers an already-applied GPU mutation to document history atomically.
 *
 * The renderer owns the pixel snapshots until this returns. On failure all
 * applied edits are undone and destroyed; on success the history entry owns
 * them until dispose. Document state never advertises pixels that failed to
 * become a reversible history operation.
 */
export const commitAppliedPixelMutation = (
  resolveDependencies: () => PixelMutationTransactionDependencies,
  mutation: CommitAppliedPixelMutation
): PixelMutationHistoryEntry => {
  if (!mutation.edits.length) {
    throw new Error(`${mutation.operation} has no reversible pixel edit.`);
  }
  const dependencies = resolveDependencies();
  if (!dependencies.getRenderer()) {
    throw new Error(`${mutation.operation} is no longer available.`);
  }
  const coordinator = new AppliedPixelMutationCoordinator<ImageDocument>(() => {
    const current = resolveDependencies();
    return {
      applyState: current.applyDocumentSnapshot,
      appendHistory: (entry) => current.pushHistoryEntry(entry as PixelMutationHistoryEntry)
    };
  });
  return coordinator.commit({
    operation: mutation.operation,
    before: mutation.before,
    undoBase: mutation.undoBase,
    redoBase: mutation.redoBase,
    after: mutation.after,
    retainedByteSize: mutation.retainedByteSize,
    steps: mutation.edits.map((edit) => ({
      byteSize: edit.byteSize,
      apply: (direction) => resolveDependencies().getRenderer()
        ?.applyPixelHistory(edit, direction) ?? false,
      dispose: () => edit.destroy()
    }))
  }, (lifecycle) => ({
    label: mutation.label,
    type: mutation.type,
    byteSize: lifecycle.byteSize,
    layerIds: mutation.layerIds,
    undo: lifecycle.undo,
    redo: lifecycle.redo,
    dispose: lifecycle.dispose
  }));
};
