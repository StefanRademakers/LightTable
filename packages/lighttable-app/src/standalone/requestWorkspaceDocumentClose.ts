import type {
  DocumentSessionId
} from '../lighttable/application/documents/documentSession';
import type {
  LightTableHost
} from '../platform/LightTableHost';
import type {
  WorkspaceDocumentTab
} from './StandaloneDocumentRuntimeView';

interface RequestWorkspaceDocumentCloseOptions {
  readonly documentId: DocumentSessionId;
  readonly documents: readonly WorkspaceDocumentTab[];
  readonly host: Pick<LightTableHost, 'confirmDiscardChanges' | 'recovery'>;
  readonly close: (
    id: DocumentSessionId,
    discardChanges: boolean
  ) => { readonly ok: boolean };
}

/**
 * Runs host confirmation policy before mutating the workspace.
 */
export const requestWorkspaceDocumentClose = async ({
  documentId,
  documents,
  host,
  close
}: RequestWorkspaceDocumentCloseOptions): Promise<boolean> => {
  const document = documents.find((candidate) => candidate.id === documentId);
  if (!document) return false;

  if (
    document.dirty
    && !await host.confirmDiscardChanges(document.title)
  ) {
    return false;
  }

  const result = close(documentId, document.dirty);
  if (result.ok && document.dirty) {
    try {
      await host.recovery?.remove(documentId);
    } catch (reason) {
      console.warn('[Recovery] Explicit discard cleanup failed.', reason);
    }
  }
  return result.ok;
};
