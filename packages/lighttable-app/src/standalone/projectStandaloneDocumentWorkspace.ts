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
import type { VideoDocumentSession } from '@lighttable/video-core';

export interface StandaloneImageWorkspaceDocument {
  readonly id: DocumentSessionId;
  readonly kind: 'image';
  readonly title: string;
  readonly dirty: boolean;
  readonly active: boolean;
  readonly runtime: StandaloneDocumentRuntime;
  readonly session: DocumentSession;
}

export interface StandaloneVideoWorkspaceDocument {
  readonly id: DocumentSessionId;
  readonly kind: 'video';
  readonly title: string;
  readonly dirty: false;
  readonly active: boolean;
  readonly runtime: { readonly kind: 'video'; readonly file: File };
  readonly session: VideoDocumentSession;
}

export type StandaloneWorkspaceDocument =
  | StandaloneImageWorkspaceDocument
  | StandaloneVideoWorkspaceDocument;

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
      kind: 'image',
      title: document.title,
      dirty: document.dirty,
      active: snapshot.activeDocumentId === id,
      runtime,
      session
    }];
  });
