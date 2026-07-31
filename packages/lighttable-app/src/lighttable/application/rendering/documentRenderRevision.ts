import type { ImageDocument } from '../../editor/document/documentTypes';

export interface DocumentRenderRevision {
  documentId: string;
  revision: number;
}

/**
 * Captures the immutable document state that can affect GPU output.
 *
 * Editor-only state such as the active layer may publish a new ImageDocument
 * object without incrementing `revision`. That must not synchronize retained
 * GPU resources or invalidate expensive render stages.
 */
export const resolveDocumentRenderRevision = (
  document: Pick<ImageDocument, 'id' | 'revision'>
): DocumentRenderRevision => ({
  documentId: document.id,
  revision: document.revision
});

export const documentRenderRevisionsEqual = (
  current: DocumentRenderRevision | null,
  next: DocumentRenderRevision
) => current?.documentId === next.documentId && current.revision === next.revision;
