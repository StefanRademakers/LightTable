import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import type { ReversiblePixelEdit } from '../../editor/history/ReversiblePixelEdit';
import { runEditorOperationTransaction } from './editorOperationTransaction';

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
  /**
   * Optional document state that must exist before GPU redo can address its
   * target (for example a newly-created layer mask).
   */
  readonly redoBase?: ImageDocument;
  readonly after: ImageDocument;
  /** Edits in their forward application order. */
  readonly edits: readonly ReversiblePixelEdit[];
}

const oppositeDirection = (direction: 'undo' | 'redo') =>
  direction === 'undo' ? 'redo' : 'undo';

const applyHistoryState = (
  resolveDependencies: () => PixelMutationTransactionDependencies,
  mutation: CommitAppliedPixelMutation,
  direction: 'undo' | 'redo'
) => {
  const dependencies = resolveDependencies();
  const renderer = dependencies.getRenderer();
  if (!renderer) throw new Error(`${mutation.operation} ${direction} is no longer available.`);
  const targetDocument = direction === 'undo' ? mutation.before : mutation.after;
  const rollbackDocument = direction === 'undo' ? mutation.after : mutation.before;
  const edits = direction === 'undo' ? [...mutation.edits].reverse() : mutation.edits;

  runEditorOperationTransaction(
    { operation: `${mutation.operation} ${direction}` },
    (transaction) => {
      if (direction === 'redo' && mutation.redoBase) {
        transaction.step(
          'prepare canonical document state',
          () => dependencies.applyDocumentSnapshot(mutation.redoBase!),
          () => dependencies.applyDocumentSnapshot(mutation.before)
        );
      }
      for (const [index, edit] of edits.entries()) {
        let changed = false;
        transaction.step(`GPU pixel state ${index + 1}`, () => {
          changed = renderer.applyPixelHistory(edit, direction);
          if (!changed) {
            throw new Error(`${mutation.operation} ${direction} is no longer available.`);
          }
        }, () => {
          if (!changed) return;
          if (!renderer.applyPixelHistory(edit, oppositeDirection(direction))) {
            throw new Error(`${mutation.operation} ${direction} GPU compensation failed.`);
          }
        });
      }
      transaction.step(
        'canonical document state',
        () => dependencies.applyDocumentSnapshot(targetDocument),
        () => dependencies.applyDocumentSnapshot(
          direction === 'redo' && mutation.redoBase
            ? mutation.redoBase
            : rollbackDocument
        )
      );
    }
  );
};

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
  const renderer = dependencies.getRenderer();
  if (!renderer) throw new Error(`${mutation.operation} is no longer available.`);
  const historyEntry: PixelMutationHistoryEntry = {
    label: mutation.label,
    type: mutation.type,
    byteSize: mutation.edits.reduce((total, edit) => total + edit.byteSize, 0),
    layerIds: mutation.layerIds,
    undo: () => applyHistoryState(resolveDependencies, mutation, 'undo'),
    redo: () => applyHistoryState(resolveDependencies, mutation, 'redo'),
    dispose: () => mutation.edits.forEach((edit) => edit.destroy())
  };

  runEditorOperationTransaction({ operation: `${mutation.operation} commit` }, (transaction) => {
    for (const [index, edit] of mutation.edits.entries()) {
      transaction.adopt(`GPU pixel state ${index + 1}`, () => {
        try {
          if (!renderer.applyPixelHistory(edit, 'undo')) {
            throw new Error(`${mutation.operation} GPU rollback is no longer available.`);
          }
        } finally {
          edit.destroy();
        }
      });
    }
    transaction.step(
      'canonical document state',
      () => dependencies.applyDocumentSnapshot(mutation.after),
      () => dependencies.applyDocumentSnapshot(mutation.before)
    );
    // History registration is deliberately last. Once it succeeds, history
    // is the sole owner of the edit snapshots and their disposal.
    dependencies.pushHistoryEntry(historyEntry);
  });
  return historyEntry;
};
