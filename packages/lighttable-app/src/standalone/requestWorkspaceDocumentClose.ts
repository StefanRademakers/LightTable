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
  readonly host: Pick<LightTableHost, 'confirmDiscardChanges'>;
  readonly documentSession?: DocumentSession | null;
  readonly discardRecovery?: (throughRevision: number) => Promise<void>;
  readonly onRecoveryCleanupFailed?: (error: Error) => void;
  readonly close: (
    id: DocumentSessionId,
    discardChanges: boolean
  ) => { readonly ok: boolean };
}

export const waitForRunningDocumentSave = (
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
  discardRecovery,
  onRecoveryCleanupFailed,
  close
}: RequestWorkspaceDocumentCloseOptions): Promise<boolean> => {
  const document = documents.find((candidate) => candidate.id === documentId);
  if (!document) return false;

  if (documentSession) {
    const saveStatus = await waitForRunningDocumentSave(documentSession);
    if (saveStatus && saveStatus !== 'completed') return false;
  }

  let admission: ReturnType<DocumentSession['acquireMutationAdmission']> | null = null;
  try {
    admission = documentSession?.acquireMutationAdmission('Document close is pending.') ?? null;
  } catch (reason) {
    onRecoveryCleanupFailed?.(reason instanceof Error ? reason : new Error(String(reason)));
    return false;
  }
  const dirty = admission?.dirty ?? document.dirty;

  try {
    if (dirty && !await host.confirmDiscardChanges(document.title)) {
      return false;
    }
    if (dirty && discardRecovery) await discardRecovery(admission?.revision ?? 0);
    if (admission) {
      const current = documentSession!.getSnapshot();
      if (current.documentRevision !== admission.revision
        || current.dirty !== admission.dirty
        || current.tasks.activeTaskIds.length > 0) return false;
    }
    return close(documentId, dirty).ok;
  } catch (reason) {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    onRecoveryCleanupFailed?.(error);
    return false;
  } finally {
    admission?.release();
  }
};
