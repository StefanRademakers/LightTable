import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { cloneAdjustments, type BasicAdjustments } from '../../types';
import { resolveBasicAdjustmentTarget } from './basicAdjustmentTarget';
import type { BasicAdjustmentTarget } from '../commands/semanticBasicAdjustmentCommandContract';
import { runEditorOperationTransaction } from '../commands/editorOperationTransaction';
import type { DocumentMutationController } from '../documents/useDocumentMutationController';
import { projectAdjustmentSnapshot } from './projectAdjustmentSnapshot';

export interface SemanticGradePatchHistoryEntry {
  readonly type: string;
  readonly label: string;
  readonly documentMutation: true;
  undo(): void;
  redo(): void;
}

export interface SemanticGradePatchOptions<TValues extends object> {
  readonly document: ImageDocument;
  readonly documentAdjustments: BasicAdjustments;
  readonly target: BasicAdjustmentTarget;
  readonly values: TValues;
  readonly historyType: string;
  readonly historyLabel: string;
  readonly mutate: (snapshot: BasicAdjustments, values: TValues) => void;
  readonly changeDocument: DocumentMutationController['change'];
  readonly publishDocumentProcessing: (snapshot: BasicAdjustments) => void;
  readonly pushProcessingHistoryEntry: (entry: SemanticGradePatchHistoryEntry) => void;
}

/** Executes one already-validated Grade patch through the canonical snapshot/history owner. */
export const executeSemanticGradePatch = <TValues extends object>({
  document,
  documentAdjustments,
  target,
  values,
  historyType,
  historyLabel,
  mutate,
  changeDocument,
  publishDocumentProcessing,
  pushProcessingHistoryEntry
}: SemanticGradePatchOptions<TValues>): { readonly target: BasicAdjustmentTarget;
  readonly values: TValues; readonly changed: boolean } => {
  const resolved = resolveBasicAdjustmentTarget(document, documentAdjustments, target);
  if ('message' in resolved) throw new Error(resolved.message);
  const before = cloneAdjustments(resolved.adjustments);
  const after = cloneAdjustments(before);
  mutate(after, values);
  if (JSON.stringify(before) === JSON.stringify(after)) return { target, values, changed: false };
  if (resolved.targetLayerId) {
    const changed = changeDocument((currentDocument) => {
      const current = resolveBasicAdjustmentTarget(
        currentDocument,
        documentAdjustments,
        target
      );
      if ('message' in current) throw new Error(current.message);
      const currentBefore = cloneAdjustments(current.adjustments);
      const currentAfter = cloneAdjustments(currentBefore);
      mutate(currentAfter, values);
      if (JSON.stringify(currentBefore) === JSON.stringify(currentAfter)) return currentDocument;
      return projectAdjustmentSnapshot({
        snapshot: currentAfter,
        targetLayerId: current.targetLayerId,
        document: currentDocument,
        documentAdjustments
      }).document ?? currentDocument;
    }, true, { label: historyLabel, type: historyType, layerIds: [resolved.targetLayerId] });
    return { target, values, changed };
  }
  const apply = (snapshot: BasicAdjustments) => publishDocumentProcessing(snapshot);
  runEditorOperationTransaction({ operation: historyLabel }, (transaction) => {
    transaction.step(
      'publish adjustment snapshot',
      () => apply(after),
      () => apply(before)
    );
    pushProcessingHistoryEntry({
      type: historyType,
      label: historyLabel,
      documentMutation: true,
      undo: () => apply(before),
      redo: () => apply(after)
    });
  });
  return { target, values, changed: true };
};
