import type {
  CommittedSelectionState,
  DocumentSessionId as KernelDocumentSessionId,
  DocumentRevision,
  SelectionReadLease,
  SelectionRevision,
  SelectionStateStore,
} from '@lighttable/editor-kernel';
import { assertCommittedSelectionState } from '@lighttable/editor-kernel';
import type { DocumentSession } from '../../documents/documentSession';
import { SelectionMaskSnapshot } from '../../../editor/selection/SelectionMaskSnapshot';
import type { SelectionOperation } from '../../../editor/selection/selectionTypes';

export type LightTableCommittedSelection = CommittedSelectionState<
  SelectionMaskSnapshot,
  SelectionOperation
>;
export type LightTableSelectionReadLease = SelectionReadLease<
  SelectionMaskSnapshot,
  SelectionOperation
>;

/** Bridges the kernel's one selection value to one explicit DocumentSession. */
export class DocumentSelectionStateStore implements SelectionStateStore<
  SelectionMaskSnapshot,
  SelectionOperation
> {
  constructor(private readonly session: DocumentSession) {}

  acquire(documentRevision: number): LightTableSelectionReadLease {
    const documentSessionId = this.session.id as unknown as KernelDocumentSessionId;
    return {
      document: {
        sessionId: documentSessionId,
        revision: documentRevision as DocumentRevision,
      },
      selection: this.read(documentSessionId),
    };
  }

  read(documentSessionId: KernelDocumentSessionId): LightTableCommittedSelection {
    if (String(documentSessionId) !== String(this.session.id)) {
      throw new Error('The selection store was addressed with another document session.');
    }
    const snapshot = this.session.getSnapshot();
    const document = snapshot.document;
    if (!document) throw new Error('The document selection is unavailable before document open.');
    const editor = snapshot.editor;
    const coverage = editor.selectionMaskSnapshot
      ?? (editor.selection.length === 0
        ? SelectionMaskSnapshot.inactive(document.width, document.height)
        : null);
    if (!coverage) {
      throw new Error('The legacy selection has operations but no exact committed coverage.');
    }
    return {
      documentSessionId,
      revision: editor.selectionRevision as SelectionRevision,
      canvas: { width: document.width, height: document.height },
      active: coverage.active,
      coverage,
      supportBounds: editor.selectionSupportBounds
        ? { ...editor.selectionSupportBounds }
        : null,
      provenance: [...editor.selection],
    };
  }

  compareAndSwap(
    expectedRevision: SelectionRevision,
    next: LightTableCommittedSelection,
  ): boolean {
    const document = this.session.getSnapshot().document;
    return document
      ? this.compareAndSwapForDocument(expectedRevision, document, next, document)
      : false;
  }

  /** Publishes a dimension-changing document and its selection as one value. */
  compareAndSwapForDocument(
    expectedRevision: SelectionRevision,
    expectedDocument: import('../../../editor/document/documentTypes').ImageDocument,
    next: LightTableCommittedSelection,
    document: import('../../../editor/document/documentTypes').ImageDocument,
  ): boolean {
    try { assertCommittedSelectionState(next); } catch { return false; }
    if (String(next.documentSessionId) !== String(this.session.id)) return false;
    if (next.canvas.width !== document.width || next.canvas.height !== document.height
      || next.coverage.width !== document.width || next.coverage.height !== document.height
      || next.coverage.active !== next.active) return false;
    return this.session.updateDocumentAndEditorIf(
      (currentDocument, current) => currentDocument === expectedDocument
        && current.selectionRevision === expectedRevision,
      document,
      (current) => ({
        ...current,
        selection: [...next.provenance],
        selectionMaskSnapshot: next.coverage,
        selectionRevision: next.revision,
        selectionSupportBounds: next.supportBounds ? { ...next.supportBounds } : null,
      }),
    );
  }
}
