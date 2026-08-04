import {
  DocumentSession,
  type CreateDocumentSessionOptions,
  type DocumentSessionId,
  type DocumentSessionSnapshot,
  type DocumentSourceDescriptor
} from '../documents/documentSession';
import type { SystemFontByteProvider } from '../../text/fonts/DocumentFontRegistry';
import type { DocumentFontAsset } from '../../editor/document/documentTypes';
import {
  failure,
  success,
  type Result
} from '../shared/result';

export interface WorkspaceSnapshot {
  readonly documentOrder: readonly DocumentSessionId[];
  readonly activeDocumentId: DocumentSessionId | null;
  readonly documents: Readonly<Record<string, DocumentSessionSnapshot>>;
}

export type WorkspaceListener = () => void;

export type WorkspaceError =
  | { readonly code: 'document-not-found'; readonly documentId: DocumentSessionId }
  | { readonly code: 'document-is-dirty'; readonly documentId: DocumentSessionId }
  | { readonly code: 'duplicate-source'; readonly sourceId: string };

export interface OpenDocumentOptions {
  readonly source: DocumentSourceDescriptor;
  readonly title?: string;
  readonly activate?: boolean;
  readonly allowDuplicateSource?: boolean;
}

export interface CloseDocumentOptions {
  readonly discardChanges?: boolean;
}

export interface WorkspaceSessionOptions {
  readonly createId?: () => DocumentSessionId;
  readonly systemFontProvider?: SystemFontByteProvider;
}

let fallbackId = 0;

const defaultCreateId = (): DocumentSessionId => {
  fallbackId += 1;
  return `document-session-${Date.now()}-${fallbackId}` as DocumentSessionId;
};

/**
 * Owns the set and ordering of open documents. It deliberately contains no
 * React, DOM, host or WebGPU dependencies.
 */
export class WorkspaceSession {
  private readonly createId: () => DocumentSessionId;
  private readonly systemFontProvider?: SystemFontByteProvider;
  private readonly sessions = new Map<DocumentSessionId, DocumentSession>();
  private readonly sessionUnsubscribers = new Map<DocumentSessionId, () => void>();
  private readonly listeners = new Set<WorkspaceListener>();
  private systemFontAssets: readonly DocumentFontAsset[] = [];
  private documentOrder: DocumentSessionId[] = [];
  private activeDocumentId: DocumentSessionId | null = null;
  private snapshot: WorkspaceSnapshot = {
    documentOrder: [],
    activeDocumentId: null,
    documents: {}
  };

  constructor(options: WorkspaceSessionOptions = {}) {
    this.createId = options.createId ?? defaultCreateId;
    this.systemFontProvider = options.systemFontProvider;
  }

  getSnapshot = (): WorkspaceSnapshot => this.snapshot;

  subscribe = (listener: WorkspaceListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getDocument(id: DocumentSessionId): DocumentSession | null {
    return this.sessions.get(id) ?? null;
  }

  getActiveDocument(): DocumentSession | null {
    return this.activeDocumentId
      ? this.sessions.get(this.activeDocumentId) ?? null
      : null;
  }

  registerSystemFontReferences(assets: readonly DocumentFontAsset[]): void {
    this.systemFontAssets = assets.filter((asset) => asset.source === 'system').map((asset) => structuredClone(asset));
    for (const session of this.sessions.values()) {
      session.fonts.registerReferences(this.systemFontAssets);
    }
  }

  open(
    options: OpenDocumentOptions
  ): Result<DocumentSession, WorkspaceError> {
    if (!options.allowDuplicateSource) {
      const duplicate = [...this.sessions.values()].find(
        (session) => session.getSnapshot().source.id === options.source.id
      );
      if (duplicate) {
        this.activate(duplicate.id);
        return failure({
          code: 'duplicate-source',
          sourceId: options.source.id
        });
      }
    }

    const createOptions: CreateDocumentSessionOptions = {
      id: this.createId(),
      source: options.source,
      title: options.title,
      systemFontProvider: this.systemFontProvider
    };
    const session = new DocumentSession(createOptions);
    session.fonts.registerReferences(this.systemFontAssets);
    this.sessions.set(session.id, session);
    this.documentOrder = [...this.documentOrder, session.id];
    this.sessionUnsubscribers.set(
      session.id,
      session.subscribe(() => this.rebuildSnapshot())
    );

    if (options.activate !== false || !this.activeDocumentId) {
      this.activeDocumentId = session.id;
    }
    this.synchronizeRendererActivity();
    this.rebuildSnapshot();
    return success(session);
  }

  activate(
    id: DocumentSessionId
  ): Result<void, WorkspaceError> {
    if (!this.sessions.has(id)) {
      return failure({ code: 'document-not-found', documentId: id });
    }
    if (this.activeDocumentId !== id) {
      this.activeDocumentId = id;
      this.synchronizeRendererActivity();
      this.rebuildSnapshot();
    }
    return success(undefined);
  }

  close(
    id: DocumentSessionId,
    options: CloseDocumentOptions = {}
  ): Result<void, WorkspaceError> {
    const session = this.sessions.get(id);
    if (!session) {
      return failure({ code: 'document-not-found', documentId: id });
    }
    if (session.getSnapshot().dirty && !options.discardChanges) {
      return failure({ code: 'document-is-dirty', documentId: id });
    }

    const closedIndex = this.documentOrder.indexOf(id);
    const wasActive = this.activeDocumentId === id;
    session.beginClosing();
    this.sessionUnsubscribers.get(id)?.();
    this.sessionUnsubscribers.delete(id);
    this.sessions.delete(id);
    this.documentOrder = this.documentOrder.filter((candidate) => candidate !== id);
    session.dispose();

    if (wasActive) {
      this.activeDocumentId = this.pickNextActiveId(closedIndex);
    }
    this.synchronizeRendererActivity();
    this.rebuildSnapshot();
    return success(undefined);
  }

  dispose(): void {
    for (const unsubscribe of this.sessionUnsubscribers.values()) unsubscribe();
    this.sessionUnsubscribers.clear();
    for (const session of this.sessions.values()) session.dispose();
    this.sessions.clear();
    this.documentOrder = [];
    this.activeDocumentId = null;
    this.rebuildSnapshot();
    this.listeners.clear();
  }

  private pickNextActiveId(closedIndex: number): DocumentSessionId | null {
    if (this.documentOrder.length === 0) return null;
    return this.documentOrder[
      Math.min(Math.max(closedIndex, 0), this.documentOrder.length - 1)
    ] ?? null;
  }

  /**
   * Workspace activation is the source of truth for renderer presentation.
   * React views may mirror this state, but a background renderer must already
   * be suspended before any host chooses how (or whether) to mount that view.
   */
  private synchronizeRendererActivity(): void {
    for (const [id, session] of this.sessions) {
      session.renderer.setActive(id === this.activeDocumentId);
    }
  }

  private rebuildSnapshot(): void {
    const documents: Record<string, DocumentSessionSnapshot> = {};
    for (const [id, session] of this.sessions) {
      documents[id] = session.getSnapshot();
    }
    this.snapshot = {
      documentOrder: [...this.documentOrder],
      activeDocumentId: this.activeDocumentId,
      documents
    };
    for (const listener of [...this.listeners]) listener();
  }
}
