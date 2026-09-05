import type { EditorHistoryEntry } from '../commands/useDocumentHistoryController';
import { runEditorOperationTransaction } from '../commands/editorOperationTransaction';
import type { DocumentMutationTransaction } from '../documents/useDocumentMutationController';
import type { ImageDocument } from '../../editor/document/documentTypes';
import type { SelectionMaskSnapshot } from '../../editor/selection/SelectionMaskSnapshot';
import type { SelectionOperation } from '../../editor/selection/selectionTypes';

export interface ReversibleDocumentSurfaceMutation {
  readonly byteSize?: number;
  apply(state: 'before' | 'after'): void;
  dispose(): void;
}

export interface CommitDocumentSurfaceMutationInput {
  readonly transaction: DocumentMutationTransaction;
  readonly afterDocument: ImageDocument;
  readonly beforeSelection: readonly SelectionOperation[];
  readonly afterSelection: readonly SelectionOperation[];
  readonly beforeSelectionMask: SelectionMaskSnapshot | null;
  readonly history: {
    readonly type: string;
    readonly label: string;
  };
  originIsCurrent(): boolean;
  captureSelectionSnapshot(): Promise<SelectionMaskSnapshot>;
  restoreSelectionSnapshot(snapshot: SelectionMaskSnapshot): Promise<boolean>;
  createRuntimeMutation(before: ImageDocument): ReversibleDocumentSurfaceMutation;
  resizeDocumentSurface(document: ImageDocument): void;
  publishDocumentSelection(
    document: ImageDocument,
    selection: readonly SelectionOperation[],
    selectionMask: SelectionMaskSnapshot
  ): void;
  pushHistoryEntry(entry: EditorHistoryEntry): void;
}

interface HistoryState {
  readonly document: ImageDocument;
  readonly selection: readonly SelectionOperation[];
  readonly selectionMask: SelectionMaskSnapshot;
  readonly runtime: 'before' | 'after';
}

const applyHistoryState = (
  input: CommitDocumentSurfaceMutationInput,
  runtimeMutation: ReversibleDocumentSurfaceMutation,
  target: HistoryState,
  rollback: HistoryState
) => runEditorOperationTransaction(
  { operation: `${input.history.label} ${target.runtime}` },
  (operation) => {
    operation.step(
      'GPU and document surface state',
      () => {
        runtimeMutation.apply(target.runtime);
        input.resizeDocumentSurface(target.document);
      },
      () => {
        runtimeMutation.apply(rollback.runtime);
        input.resizeDocumentSurface(rollback.document);
      }
    );
    operation.step(
      'canonical document and selection state',
      () => input.publishDocumentSelection(
        target.document,
        target.selection,
        target.selectionMask
      ),
      () => input.publishDocumentSelection(
        rollback.document,
        rollback.selection,
        rollback.selectionMask
      )
    );
  }
);

/**
 * Commits a document-sized GPU mutation, canonical document state, exact
 * selection state and history entry as one owned operation.
 *
 * GPU preparation remains asynchronous where exact selection capture requires
 * it, but the document lease stays active for that entire interval. Until
 * history accepts ownership, every prepared runtime resource is rolled back
 * and disposed on failure.
 */
export const commitDocumentSurfaceMutation = async (
  input: CommitDocumentSurfaceMutationInput
): Promise<boolean> => {
  const { transaction } = input;
  if (!transaction.stage(() => input.afterDocument)) return false;

  let runtimeMutation: ReversibleDocumentSurfaceMutation | null = null;
  let surfaceMayBeAfter = false;
  let rollbackComplete = false;
  let historyOwnsRuntime = false;

  const rollbackPreparedRuntime = () => {
    if (rollbackComplete || historyOwnsRuntime) return;
    rollbackComplete = true;
    const failures: unknown[] = [];
    if (runtimeMutation) {
      try {
        runtimeMutation.apply('before');
      } catch (reason) {
        failures.push(reason);
      }
    }
    if (surfaceMayBeAfter) {
      try {
        input.resizeDocumentSurface(transaction.before);
      } catch (reason) {
        failures.push(reason);
      }
    }
    if (runtimeMutation) {
      try {
        runtimeMutation.dispose();
      } catch (reason) {
        failures.push(reason);
      }
    }
    if (failures.length) {
      throw new AggregateError(
        failures,
        `${input.history.label} runtime rollback did not complete.`
      );
    }
  };

  try {
    const committed = await transaction.commitWithAsync(async (before, after) => {
      const exactBeforeSelectionMask = input.beforeSelectionMask
        ?? await input.captureSelectionSnapshot();
      if (!input.originIsCurrent()) {
        throw new Error(`${input.history.label} lost its document or selection ownership.`);
      }
      if (!await input.restoreSelectionSnapshot(exactBeforeSelectionMask)) {
        throw new Error(`The exact selection state could not be prepared for ${input.history.label}.`);
      }

      runtimeMutation = input.createRuntimeMutation(before);
      // The surface implementation may throw after changing dimensions, so
      // install rollback responsibility before invoking it.
      surfaceMayBeAfter = true;
      input.resizeDocumentSurface(after);
      const afterSelectionMask = await input.captureSelectionSnapshot();
      if (!input.originIsCurrent()) {
        throw new Error(`${input.history.label} lost its document or selection ownership.`);
      }

      const beforeState: HistoryState = {
        document: before,
        selection: input.beforeSelection,
        selectionMask: exactBeforeSelectionMask,
        runtime: 'before'
      };
      const afterState: HistoryState = {
        document: after,
        selection: input.afterSelection,
        selectionMask: afterSelectionMask,
        runtime: 'after'
      };
      const mutation = runtimeMutation;

      runEditorOperationTransaction(
        { operation: `${input.history.label} commit` },
        (operation) => {
          operation.adopt('prepared GPU and document surface state', rollbackPreparedRuntime);
          operation.step(
            'canonical document and selection state',
            () => input.publishDocumentSelection(
              afterState.document,
              afterState.selection,
              afterState.selectionMask
            ),
            () => input.publishDocumentSelection(
              beforeState.document,
              beforeState.selection,
              beforeState.selectionMask
            )
          );
          input.pushHistoryEntry({
            type: input.history.type,
            label: input.history.label,
            documentMutation: true,
            byteSize: beforeState.selectionMask.byteSize
              + afterState.selectionMask.byteSize
              + (mutation.byteSize ?? 0),
            undo: () => applyHistoryState(input, mutation, beforeState, afterState),
            redo: () => applyHistoryState(input, mutation, afterState, beforeState),
            dispose: () => mutation.dispose()
          });
        }
      );
      historyOwnsRuntime = true;
      return true;
    });
    if (!committed) rollbackPreparedRuntime();
    return committed;
  } catch (reason) {
    try {
      rollbackPreparedRuntime();
    } catch (rollbackReason) {
      throw new AggregateError(
        [reason, rollbackReason],
        `${input.history.label} failed and its runtime state could not be restored.`
      );
    }
    throw reason;
  }
};
