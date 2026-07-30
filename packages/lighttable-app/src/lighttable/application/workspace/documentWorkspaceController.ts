import type {
  DocumentSession,
  DocumentSessionId,
  DocumentSourceDescriptor
} from '../documents/documentSession';
import type { Result } from '../shared/result';
import {
  WorkspaceSession,
  type CloseDocumentOptions,
  type WorkspaceError,
  type WorkspaceSessionOptions,
  type WorkspaceSnapshot
} from './workspaceSession';

export interface OpenWorkspaceDocument<TSource> {
  readonly source: DocumentSourceDescriptor;
  readonly payload: TSource;
  readonly title?: string;
}

/**
 * Coordinates the host-owned source handle with its application document.
 *
 * WorkspaceSession deliberately knows nothing about File, Blob, URLs or
 * Electron paths. This controller keeps the opaque source payload alive for
 * exactly the lifetime of its DocumentSession and removes the split React
 * state that previously made tabs and runtimes drift apart.
 */
export class DocumentWorkspaceController<TSource> {
  readonly workspace: WorkspaceSession;

  private readonly sources = new Map<DocumentSessionId, TSource>();
  private disposed = false;

  constructor(options: WorkspaceSessionOptions = {}) {
    this.workspace = new WorkspaceSession(options);
  }

  getSnapshot = (): WorkspaceSnapshot => this.workspace.getSnapshot();

  subscribe = (listener: () => void): (() => void) => {
    this.assertUsable();
    return this.workspace.subscribe(listener);
  };

  open(
    input: OpenWorkspaceDocument<TSource>
  ): Result<DocumentSession, WorkspaceError> {
    this.assertUsable();
    const opened = this.workspace.open({
      source: input.source,
      title: input.title
    });
    if (opened.ok) this.sources.set(opened.value.id, input.payload);
    return opened;
  }

  activate(id: DocumentSessionId): Result<void, WorkspaceError> {
    this.assertUsable();
    return this.workspace.activate(id);
  }

  close(
    id: DocumentSessionId,
    options: CloseDocumentOptions = {}
  ): Result<void, WorkspaceError> {
    this.assertUsable();
    const closed = this.workspace.close(id, options);
    if (closed.ok) this.sources.delete(id);
    return closed;
  }

  getDocument(id: DocumentSessionId): DocumentSession | null {
    this.assertUsable();
    return this.workspace.getDocument(id);
  }

  getSource(id: DocumentSessionId): TSource | null {
    this.assertUsable();
    return this.sources.get(id) ?? null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.workspace.dispose();
    this.sources.clear();
  }

  private assertUsable(): void {
    if (this.disposed) throw new Error('Document workspace controller is disposed.');
  }
}
