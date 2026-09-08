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
