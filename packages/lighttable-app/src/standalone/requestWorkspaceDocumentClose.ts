import type {
  DocumentSession,
  DocumentSessionId
} from '../lighttable/application/documents/documentSession';
import type { DocumentTaskStatus } from '../lighttable/application/tasks/documentTaskRegistry';
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
  readonly documentSession?: DocumentSession | null;
  readonly close: (
    id: DocumentSessionId,
    discardChanges: boolean
  ) => { readonly ok: boolean };
}

const waitForRunningSave = (
  session: DocumentSession
): Promise<DocumentTaskStatus | null> => {
  const snapshot = session.getSnapshot().tasks;
  const taskId = snapshot.activeTaskIds.find(
    (id) => snapshot.tasks[id]?.kind === 'save'
  );
  if (!taskId) return Promise.resolve(null);

  return new Promise((resolve) => {
    let unsubscribe: () => void = () => {};
    const inspect = () => {
      const task = session.getSnapshot().tasks.tasks[taskId];
      if (task?.status === 'running') return;
      unsubscribe();
      resolve(task?.status ?? 'canceled');
    };
    unsubscribe = session.subscribe(inspect);
    inspect();
  });
};

/**
 * Runs host confirmation policy before mutating the workspace.
 */
export const requestWorkspaceDocumentClose = async ({
  documentId,
  documents,
  host,
  documentSession = null,
  close
}: RequestWorkspaceDocumentCloseOptions): Promise<boolean> => {
  const document = documents.find((candidate) => candidate.id === documentId);
  if (!document) return false;

  if (documentSession) {
    const saveStatus = await waitForRunningSave(documentSession);
    if (saveStatus && (
      saveStatus !== 'completed'
      || documentSession.getSnapshot().dirty
    )) return false;
  }

  const dirty = documentSession?.getSnapshot().dirty ?? document.dirty;

  if (
    dirty
    && !await host.confirmDiscardChanges(document.title)
  ) {
    return false;
  }

  const result = close(documentId, dirty);
  if (result.ok && dirty) {
    try {
      await host.recovery?.remove(documentId);
    } catch (reason) {
      console.warn('[Recovery] Explicit discard cleanup failed.', reason);
    }
  }
  return result.ok;
};
