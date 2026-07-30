import {
  createEditorSession,
  type EditorSession
} from '../../editor/session/editorSession';
import {
  DocumentCommandHistory,
  type DocumentCommandHistorySnapshot
} from '../commands/documentCommandHistory';
import {
  DocumentTaskRegistry,
  type DocumentTaskRegistrySnapshot
} from '../tasks/documentTaskRegistry';
import {
  DocumentRendererLifecycle,
  type DocumentRendererSnapshot
} from '../rendering/documentRendererLifecycle';

export type DocumentSessionId = string & {
  readonly __brand: 'DocumentSessionId';
};

export type DocumentLifecycle =
  | 'opening'
  | 'ready'
  | 'failed'
  | 'closing'
  | 'disposed';

export interface DocumentSourceDescriptor {
  readonly id: string;
  readonly name: string;
  readonly mediaType: string;
  readonly byteLength?: number;
}

export interface DocumentViewport {
  readonly zoomMode: 'fit' | '100' | 'custom';
  readonly scale: number;
  readonly panX: number;
  readonly panY: number;
}

export interface DocumentSessionSnapshot {
  readonly id: DocumentSessionId;
  readonly source: DocumentSourceDescriptor;
  readonly title: string;
  readonly lifecycle: DocumentLifecycle;
  readonly lifecycleError: string | null;
  readonly dirty: boolean;
  readonly documentRevision: number;
  readonly savedRevision: number;
  readonly history: DocumentCommandHistorySnapshot;
  readonly tasks: DocumentTaskRegistrySnapshot;
  readonly renderer: DocumentRendererSnapshot;
  readonly editor: EditorSession;
  readonly viewport: DocumentViewport;
}

export type DocumentSessionListener = () => void;

export interface CreateDocumentSessionOptions {
  readonly id: DocumentSessionId;
  readonly source: DocumentSourceDescriptor;
  readonly title?: string;
  readonly editor?: EditorSession;
  readonly viewport?: DocumentViewport;
}

const DEFAULT_VIEWPORT: DocumentViewport = {
  zoomMode: 'fit',
  scale: 1,
  panX: 0,
  panY: 0
};

const cloneEditorSession = (session: EditorSession): EditorSession => ({
  ...session,
  selection: [...session.selection],
  brush: { ...session.brush }
});

/**
 * Application-owned state for one open document.
 *
 * Canonical image data and GPU resources are attached by later migration
 * phases. This session already owns every piece of editor state that must stay
 * isolated when the workspace switches documents.
 */
export class DocumentSession {
  readonly id: DocumentSessionId;
  readonly history: DocumentCommandHistory;
  readonly tasks: DocumentTaskRegistry;
  readonly renderer: DocumentRendererLifecycle;

  private snapshot: DocumentSessionSnapshot;
  private readonly listeners = new Set<DocumentSessionListener>();
  private readonly disposers = new Set<() => void>();
  private readonly unsubscribeHistory: () => void;
  private readonly unsubscribeTasks: () => void;
  private readonly unsubscribeRenderer: () => void;

  constructor(options: CreateDocumentSessionOptions) {
    this.id = options.id;
    this.history = new DocumentCommandHistory(options.id);
    this.tasks = new DocumentTaskRegistry(options.id);
    this.renderer = new DocumentRendererLifecycle();
    this.snapshot = {
      id: options.id,
      source: { ...options.source },
      title: options.title ?? options.source.name,
      lifecycle: 'opening',
      lifecycleError: null,
      dirty: false,
      documentRevision: 0,
      savedRevision: 0,
      history: this.history.getSnapshot(),
      tasks: this.tasks.getSnapshot(),
      renderer: this.renderer.getSnapshot(),
      editor: cloneEditorSession(options.editor ?? createEditorSession()),
      viewport: { ...(options.viewport ?? DEFAULT_VIEWPORT) }
    };
    this.unsubscribeHistory = this.history.subscribe((history) => {
      if (this.snapshot.lifecycle === 'disposed') return;
      this.update({
        history,
        dirty: history.dirty || this.snapshot.documentRevision !== this.snapshot.savedRevision
      });
    });
    this.unsubscribeTasks = this.tasks.subscribe((tasks) => {
      if (this.snapshot.lifecycle === 'disposed') return;
      this.update({ tasks });
    });
    this.unsubscribeRenderer = this.renderer.subscribe((renderer) => {
      if (this.snapshot.lifecycle === 'disposed') return;
      this.update({ renderer });
    });
  }

  getSnapshot = (): DocumentSessionSnapshot => this.snapshot;

  subscribe = (listener: DocumentSessionListener): (() => void) => {
    this.assertUsable();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  registerDisposer(disposer: () => void): () => void {
    this.assertUsable();
    this.disposers.add(disposer);
    return () => this.disposers.delete(disposer);
  }

  setReady(): void {
    this.update({
      lifecycle: 'ready',
      lifecycleError: null
    });
  }

  setFailed(reason: string): void {
    this.update({
      lifecycle: 'failed',
      lifecycleError: reason
    });
  }

  setTitle(title: string): void {
    const normalized = title.trim();
    if (!normalized || normalized === this.snapshot.title) return;
    this.update({ title: normalized });
  }

  updateEditor(
    updater: (current: EditorSession) => EditorSession
  ): void {
    this.assertEditable();
    const next = cloneEditorSession(updater(cloneEditorSession(this.snapshot.editor)));
    this.update({ editor: next });
  }

  updateViewport(
    updater: (current: DocumentViewport) => DocumentViewport
  ): void {
    this.assertEditable();
    this.update({
      viewport: { ...updater({ ...this.snapshot.viewport }) }
    });
  }

  markChanged(revision = this.snapshot.documentRevision + 1): void {
    this.assertEditable();
    if (revision < this.snapshot.documentRevision) {
      throw new Error('Document revisions must be monotonic.');
    }
    this.update({
      documentRevision: revision,
      dirty: revision !== this.snapshot.savedRevision
    });
  }

  markSaved(revision = this.snapshot.documentRevision): void {
    this.assertEditable();
    if (revision > this.snapshot.documentRevision) {
      throw new Error('A saved revision cannot be newer than the document.');
    }
    this.history.markSaved();
    this.update({
      savedRevision: revision,
      history: this.history.getSnapshot(),
      dirty: revision !== this.snapshot.documentRevision || this.history.getSnapshot().dirty
    });
  }

  beginClosing(): void {
    if (this.snapshot.lifecycle === 'disposed') return;
    this.update({ lifecycle: 'closing' });
  }

  dispose(): void {
    if (this.snapshot.lifecycle === 'disposed') return;
    this.snapshot = {
      ...this.snapshot,
      lifecycle: 'disposed'
    };
    this.unsubscribeHistory();
    this.unsubscribeTasks();
    this.unsubscribeRenderer();
    this.history.dispose();
    this.tasks.dispose();
    this.renderer.dispose();
    for (const disposer of this.disposers) disposer();
    this.disposers.clear();
    this.emit();
    this.listeners.clear();
  }

  private update(
    patch: Partial<Omit<DocumentSessionSnapshot, 'id' | 'source'>>
  ): void {
    this.assertUsable();
    this.snapshot = {
      ...this.snapshot,
      ...patch
    };
    this.emit();
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }

  private assertUsable(): void {
    if (this.snapshot.lifecycle === 'disposed') {
      throw new Error(`Document session ${this.id} is disposed.`);
    }
  }

  private assertEditable(): void {
    this.assertUsable();
    if (this.snapshot.lifecycle === 'closing') {
      throw new Error(`Document session ${this.id} is closing.`);
    }
  }
}
