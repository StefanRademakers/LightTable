import { describe, expect, it } from 'vitest';
import {
  documentRenderRevisionsEqual,
  resolveDocumentRenderRevision
} from './documentRenderRevision';
import type { DocumentId } from '../../editor/document/documentTypes';

const documentId = (value: string) => value as DocumentId;

describe('document render revision', () => {
  it('treats repeated publications of the same immutable revision as unchanged', () => {
    const current = resolveDocumentRenderRevision({ id: documentId('document-1'), revision: 4 });
    const next = resolveDocumentRenderRevision({ id: documentId('document-1'), revision: 4 });

    expect(documentRenderRevisionsEqual(current, next)).toBe(true);
  });

  it('detects a semantic document revision change', () => {
    const current = resolveDocumentRenderRevision({ id: documentId('document-1'), revision: 4 });
    const next = resolveDocumentRenderRevision({ id: documentId('document-1'), revision: 5 });

    expect(documentRenderRevisionsEqual(current, next)).toBe(false);
  });

  it('never reuses render state across documents', () => {
    const current = resolveDocumentRenderRevision({ id: documentId('document-1'), revision: 4 });
    const next = resolveDocumentRenderRevision({ id: documentId('document-2'), revision: 4 });

    expect(documentRenderRevisionsEqual(current, next)).toBe(false);
  });
});
