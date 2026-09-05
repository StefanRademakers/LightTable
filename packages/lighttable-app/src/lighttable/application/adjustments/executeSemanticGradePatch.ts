import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { cloneAdjustments, type BasicAdjustments } from '../../types';
import { resolveBasicAdjustmentTarget } from './basicAdjustmentTarget';
import type { BasicAdjustmentTarget } from '../commands/semanticBasicAdjustmentCommandContract';
import { runEditorOperationTransaction } from '../commands/editorOperationTransaction';

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
  readonly publish: (snapshot: BasicAdjustments, targetLayerId: LayerId | null) => void;
  readonly pushHistoryEntry: (entry: SemanticGradePatchHistoryEntry) => void;
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
  publish,
  pushHistoryEntry
}: SemanticGradePatchOptions<TValues>): { readonly target: BasicAdjustmentTarget;
  readonly values: TValues; readonly changed: boolean } => {
  const resolved = resolveBasicAdjustmentTarget(document, documentAdjustments, target);
  if ('message' in resolved) throw new Error(resolved.message);
  const before = cloneAdjustments(resolved.adjustments);
  const after = cloneAdjustments(before);
  mutate(after, values);
  if (JSON.stringify(before) === JSON.stringify(after)) return { target, values, changed: false };
  const apply = (snapshot: BasicAdjustments) => publish(snapshot, resolved.targetLayerId);
  runEditorOperationTransaction({ operation: historyLabel }, (transaction) => {
    transaction.step(
      'publish adjustment snapshot',
      () => apply(after),
      () => apply(before)
    );
    pushHistoryEntry({
      type: historyType,
      label: historyLabel,
      documentMutation: true,
      undo: () => apply(before),
      redo: () => apply(after)
    });
  });
  return { target, values, changed: true };
};
