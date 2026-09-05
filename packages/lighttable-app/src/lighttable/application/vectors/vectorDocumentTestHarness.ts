import type { ImageDocument } from '../../editor/document/documentTypes';
import {
  createDocumentMutationController,
  type DocumentMutationHistoryEntry
} from '../documents/useDocumentMutationController';

export interface VectorDocumentHistoryRecord {
  readonly before: ImageDocument;
  readonly after: ImageDocument;
  readonly entry: DocumentMutationHistoryEntry;
}

/** Test host that mirrors the document-owned projection and history boundary. */
export const createVectorDocumentTestHarness = (initialDocument: ImageDocument) => {
  let document = initialDocument;
  let projectedDocument = initialDocument;
  let pendingHistory: Omit<VectorDocumentHistoryRecord, 'entry'> | null = null;
  const history: VectorDocumentHistoryRecord[] = [];
  const mutations = createDocumentMutationController(() => ({
    getDocument: () => document,
    applySnapshot: (next: ImageDocument) => {
      pendingHistory = { before: document, after: next };
      document = next;
      projectedDocument = next;
    },
    previewSnapshot: (next: ImageDocument) => { projectedDocument = next; },
    discardPreview: () => { projectedDocument = document; },
    pushHistoryEntry: (entry: DocumentMutationHistoryEntry) => {
      if (!pendingHistory) throw new Error('History was recorded without applying a document.');
      history.push({ ...pendingHistory, entry });
      pendingHistory = null;
    }
  }));
  return {
    dependencies: {
      getDocument: () => document,
      documentMutations: mutations
    },
    mutations,
    history,
    get document() { return projectedDocument; },
    get canonicalDocument() { return document; },
    replaceDocument(next: ImageDocument) {
      document = next;
      projectedDocument = next;
      pendingHistory = null;
    }
  };
};
