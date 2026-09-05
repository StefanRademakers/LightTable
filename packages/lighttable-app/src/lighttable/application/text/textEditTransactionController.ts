import type { TextLayerData } from '@lighttable/text-core';
import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { applyTextLayerDataMutation } from '../../editor/document/textLayerCommands';
import { runEditorOperationTransaction } from '../commands/editorOperationTransaction';
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

export interface TextEditHistoryEntry {
  readonly layerIds: readonly LayerId[];
  readonly resourceIds: readonly LayerId[];
  readonly group: TextEditGroupKind;
  readonly semanticReplacement: TextEditSemanticReplacement | null;
  undo(): void;
  redo(): void;
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
  applyDocument(document: ImageDocument): void;
  pushHistory(entry: TextEditHistoryEntry): void;
}

export interface TextEditTransactionController {
  readonly active: boolean;
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
  latest: ImageDocument;
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

  const applyForDocument = (documentId: ImageDocument['id'], document: ImageDocument) => {
    const dependencies = resolveDependencies();
    if (dependencies.getDocument()?.id !== documentId) {
      throw new Error('The text edit belongs to a different document.');
    }
    dependencies.applyDocument(document);
  };

  return {
    get active() {
      return edit !== null;
    },
    begin: (layerId, group) => {
      if (edit) return false;
      const document = resolveDependencies().getDocument();
      if (!document || findDocumentLayer(document, layerId)?.type !== 'text') return false;
      edit = {
        documentId: document.id,
        layerId,
        group,
        before: document,
        latest: document,
        changed: false
      };
      return true;
    },
    apply: (change) => {
      if (!edit) return false;
      const dependencies = resolveDependencies();
      const current = dependencies.getDocument();
      if (!current || current.id !== edit.documentId || current !== edit.latest) {
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
      dependencies.applyDocument(next);
      edit.latest = next;
      edit.changed = true;
      return true;
    },
    commit: () => {
      if (!edit) return false;
      const completed = edit;
      edit = null;
      const dependencies = resolveDependencies();
      const after = dependencies.getDocument();
      if (!completed.changed || after !== completed.latest) return false;
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
      runEditorOperationTransaction({ operation: 'Commit text edit' }, (transaction) => {
        // The edited document is already live because typing is rendered at
        // input cadence. Until history accepts ownership, retain compensation
        // for that publication so a rejected command cannot strand the edit.
        transaction.adopt(
          'published text document',
          () => applyForDocument(completed.documentId, completed.before)
        );
        dependencies.pushHistory({
          layerIds: [completed.layerId],
          resourceIds: [],
          group: completed.group,
          semanticReplacement,
          undo: () => applyForDocument(completed.documentId, completed.before),
          redo: () => applyForDocument(completed.documentId, after)
        });
      });
      return true;
    },
    cancel: () => {
      if (!edit) return false;
      const cancelled = edit;
      edit = null;
      const current = resolveDependencies().getDocument();
      if (!current || current !== cancelled.latest) return false;
      if (current !== cancelled.before) {
        resolveDependencies().applyDocument(cancelled.before);
      }
      return true;
    },
    reset: () => {
      edit = null;
    }
  };
};
