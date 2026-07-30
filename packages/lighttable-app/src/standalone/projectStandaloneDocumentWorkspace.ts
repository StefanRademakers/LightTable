import type {
  DocumentSession,
  DocumentSessionId
} from '../lighttable/application/documents/documentSession';
import type {
  DocumentWorkspaceController
} from '../lighttable/application/workspace/documentWorkspaceController';
import type {
  WorkspaceSnapshot
} from '../lighttable/application/workspace/workspaceSession';
import type {
  StandaloneDocumentRuntime
} from './standaloneDocumentRuntime';

export interface StandaloneWorkspaceDocument {
  readonly id: DocumentSessionId;
  readonly title: string;
  readonly dirty: boolean;
  readonly active: boolean;
  readonly runtime: StandaloneDocumentRuntime;
  readonly session: DocumentSession;
}

/**
 * Joins the immutable application snapshot with host-owned source handles.
 *
 * This is the only projection the standalone React shell needs. Keeping the
 * join outside the component prevents UI composition from reaching into the
 * workspace controller for each individual concern.
 */
export const projectStandaloneDocumentWorkspace = (
  controller: DocumentWorkspaceController<StandaloneDocumentRuntime>,
  snapshot: WorkspaceSnapshot
): readonly StandaloneWorkspaceDocument[] =>
  snapshot.documentOrder.flatMap((id) => {
    const document = snapshot.documents[id];
    const runtime = controller.getSource(id);
    const session = controller.getDocument(id);
    if (!document || !runtime || !session) return [];
    return [{
      id,
      title: document.title,
      dirty: document.dirty,
      active: snapshot.activeDocumentId === id,
      runtime,
      session
    }];
  });
