import type { TextLayerData } from '@lighttable/text-core';
import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { applyTextLayerDataMutation } from '../../editor/document/textLayerCommands';
import type {
  DocumentMutationController,
  DocumentMutationTransaction
} from '../documents/useDocumentMutationController';
import { graphemeStops } from './flowTextEditing';

export type TextEditGroupKind =
  | 'typing'
  | 'composition'
  | 'delete'
  | 'format'
  | 'layout';

export const TEXT_EDIT_COALESCING_RULES = Object.freeze({
  typing: 'One explicit contiguous insertion group; caret/selection movement commits it.',
  composition: 'One compositionstart-to-compositionend group.',
  delete: 'One explicit contiguous backward or forward deletion group.',
  format: 'One committed property gesture or command.',
  layout: 'One committed frame/transform gesture.'
} satisfies Record<TextEditGroupKind, string>);

export interface TextEditCommitObservation {
  readonly layerId: LayerId;
  readonly group: TextEditGroupKind;
  readonly semanticReplacement: TextEditSemanticReplacement | null;
}

export interface TextEditSemanticReplacement {
  readonly layerId: LayerId;
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export const describeTextReplacement = (
  layerId: LayerId,
  before: string,
  after: string
): TextEditSemanticReplacement | null => {
  if (before === after) return null;
  const beforeStops = graphemeStops(before);
  const afterStops = graphemeStops(after);
  const beforeCount = beforeStops.length - 1;
  const afterCount = afterStops.length - 1;
  let prefix = 0;
  while (prefix < beforeCount && prefix < afterCount
    && before.slice(beforeStops[prefix], beforeStops[prefix + 1])
      === after.slice(afterStops[prefix], afterStops[prefix + 1])) prefix += 1;
  let suffix = 0;
  while (suffix < beforeCount - prefix && suffix < afterCount - prefix
    && before.slice(beforeStops[beforeCount - suffix - 1], beforeStops[beforeCount - suffix])
      === after.slice(afterStops[afterCount - suffix - 1], afterStops[afterCount - suffix])) suffix += 1;
  const start = beforeStops[prefix] ?? before.length;
  const end = beforeStops[beforeCount - suffix] ?? before.length;
  const replacementStart = afterStops[prefix] ?? after.length;
  const replacementEnd = afterStops[afterCount - suffix] ?? after.length;
  return { layerId, start, end, text: after.slice(replacementStart, replacementEnd) };
};

export interface TextEditTransactionDependencies {
  getDocument(): ImageDocument | null;
  documentMutations: Pick<DocumentMutationController, 'begin'>;
  onCommitted(entry: TextEditCommitObservation): void;
  reportError(message: string): void;
  requestPreviewFrame(callback: () => void): number;
  cancelPreviewFrame(frame: number): void;
}

export interface TextEditTransactionController {
  readonly unchanged: boolean;
  readonly active: boolean;
  currentDocument(): ImageDocument | null;
  begin(layerId: LayerId, group: TextEditGroupKind): boolean;
  apply(change: (text: TextLayerData) => TextLayerData): boolean;
  commit(): boolean;
  cancel(): boolean;
  reset(): void;
}

interface ActiveTextEdit {
  readonly documentId: ImageDocument['id'];
  readonly layerId: LayerId;
  readonly group: TextEditGroupKind;
  readonly before: ImageDocument;
  readonly transaction: DocumentMutationTransaction;
  previewFrame: number | null;
  changed: boolean;
}

/**
 * Owns the history boundary for future textarea/IME and property sessions.
 * Coalescing is explicit: only changes between one begin/commit pair share a
 * history entry. Timeouts and React render cadence never redefine undo.
 */
export const createTextEditTransactionController = (
  resolveDependencies: () => TextEditTransactionDependencies
): TextEditTransactionController => {
  let edit: ActiveTextEdit | null = null;

  const cancelPreviewFrame = (active: ActiveTextEdit) => {
    if (active.previewFrame === null) return;
    resolveDependencies().cancelPreviewFrame(active.previewFrame);
    active.previewFrame = null;
  };

  return {
    get unchanged() {
      return Boolean(edit && !edit.changed && edit.transaction.active
        && resolveDependencies().getDocument() === edit.before);
    },
    get active() {
      return edit !== null;
    },
    currentDocument: () => edit?.transaction.current ?? resolveDependencies().getDocument(),
    begin: (layerId, group) => {
      if (edit) return false;
      const dependencies = resolveDependencies();
      const document = dependencies.getDocument();
      if (!document || findDocumentLayer(document, layerId)?.type !== 'text') return false;
      const transaction = dependencies.documentMutations.begin(
        `text-edit:${layerId}`,
        {
          label: group === 'composition' ? 'Compose text' : 'Edit text',
          type: `text.${group}`,
          layerIds: [layerId]
        }
      );
      if (!transaction || transaction.before !== document) return false;
      edit = {
        documentId: document.id,
        layerId,
        group,
        before: document,
        transaction,
        previewFrame: null,
        changed: false
      };
      return true;
    },
    apply: (change) => {
      if (!edit) return false;
      const current = edit.transaction.current;
      if (!edit.transaction.active || current.id !== edit.documentId) {
        edit = null;
        return false;
      }
      const owner = findDocumentLayer(current, edit.layerId);
      if (owner?.type !== 'text') {
        edit = null;
        return false;
      }
      const next = applyTextLayerDataMutation(current, edit.layerId, change(owner.text));
      if (next === current) return false;
      if (!edit.transaction.stage(() => next)) {
        edit = null;
        return false;
      }
      if (edit.previewFrame === null) {
        const active = edit;
        active.previewFrame = resolveDependencies().requestPreviewFrame(() => {
          if (edit !== active) return;
          active.previewFrame = null;
          try {
            if (!active.transaction.project()) edit = null;
          } catch (error) {
            edit = null;
            resolveDependencies().reportError(error instanceof Error
              ? `The text preview failed: ${error.message}`
              : 'The text preview failed.');
          }
        });
      }
      edit.changed = true;
      return true;
    },
    commit: () => {
      if (!edit) return false;
      const completed = edit;
      edit = null;
      cancelPreviewFrame(completed);
      const after = completed.transaction.current;
      if (!completed.changed || !completed.transaction.active) {
        completed.transaction.cancel();
        return false;
      }
      const beforeLayer = findDocumentLayer(completed.before, completed.layerId);
      const afterLayer = findDocumentLayer(after, completed.layerId);
      const semanticReplacement = beforeLayer?.type === 'text'
        && beforeLayer.text.source.kind === 'flow'
        && afterLayer?.type === 'text'
        && afterLayer.text.source.kind === 'flow'
        ? describeTextReplacement(
          completed.layerId,
          beforeLayer.text.source.text,
          afterLayer.text.source.text
        )
        : null;
      const committed = completed.transaction.commit();
      if (!committed) return false;
      try {
        resolveDependencies().onCommitted({
          layerId: completed.layerId,
          group: completed.group,
          semanticReplacement
        });
      } catch (error) {
        resolveDependencies().reportError(error instanceof Error
          ? `The text edit committed, but command observation failed: ${error.message}`
          : 'The text edit committed, but command observation failed.');
      }
      return committed;
    },
    cancel: () => {
      if (!edit) return false;
      const cancelled = edit;
      edit = null;
      cancelPreviewFrame(cancelled);
      const originIsCurrent = resolveDependencies().getDocument() === cancelled.before;
      const didCancel = cancelled.transaction.cancel();
      return originIsCurrent && didCancel;
    },
    reset: () => {
      if (edit) cancelPreviewFrame(edit);
      edit?.transaction.cancel();
      edit = null;
    }
  };
};
