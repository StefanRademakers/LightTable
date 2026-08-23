import {
  createDocumentEditorState,
  type DocumentEditorState
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
  type DocumentRendererSnapshot
} from '../rendering/documentRendererLifecycle';
import type { ImageDocument } from '../../editor/document/documentTypes';
import {
  DocumentFontRegistry,
  type SystemFontByteProvider
} from '../../text/fonts/DocumentFontRegistry';
import { FontationsFontFaceParser } from '../../text/fonts/FontationsFontFaceParser';
import { createDefaultAdjustments, type BasicAdjustments } from '../../types';
import {
  createDefaultGroupVisibility,
  type GroupVisibility
} from '../adjustments/groupVisibility';
import type { LightTableImageMetadata } from '../../types';
import type {
  FontAssetBlob,
  PreservedSourceAssetBlob
} from '../../editor/persistence/layeredDocumentFormat';
import type {
  DocumentStartupTimeline,
  DocumentStartupTimelineSnapshot
} from '../telemetry/documentStartupTimeline';

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

/** Canonical document-wide processing that is not part of the layer tree. */
export interface DocumentProcessingState {
  readonly adjustments: BasicAdjustments;
  readonly globalGradeStrength: number;
  readonly groupVisibility: GroupVisibility;
}

/** Decoded source payloads required for exact save/rebind without reopening. */
export interface DocumentLoadedSourceState {
  readonly metadata: LightTableImageMetadata | null;
  readonly name: string;
  readonly blob: Blob | null;
  readonly identity: string;
  readonly fontAssets: readonly FontAssetBlob[];
  readonly preservedSources: readonly PreservedSourceAssetBlob[];
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
  /** Canonical immutable layer tree for this open document. */
  readonly document: ImageDocument | null;
  readonly editor: DocumentEditorState;
  readonly viewport: DocumentViewport;
  readonly processing: DocumentProcessingState;
  readonly loadedSource: DocumentLoadedSourceState;
}

export type DocumentSessionListener = () => void;

export interface CreateDocumentSessionOptions {
  readonly id: DocumentSessionId;
  readonly source: DocumentSourceDescriptor;
  readonly title?: string;
  readonly editor?: DocumentEditorState;
  readonly viewport?: DocumentViewport;
  readonly systemFontProvider?: SystemFontByteProvider;
  readonly processing?: DocumentProcessingState;
}

const DEFAULT_VIEWPORT: DocumentViewport = {
  zoomMode: 'fit',
  scale: 1,
  panX: 0,
  panY: 0
};

const createDefaultProcessingState = (): DocumentProcessingState => ({
  adjustments: createDefaultAdjustments(),
  globalGradeStrength: 100,
  groupVisibility: createDefaultGroupVisibility()
});

const cloneProcessingState = (
  state: DocumentProcessingState
): DocumentProcessingState => structuredClone(state);

const cloneLoadedSourceState = (
  state: DocumentLoadedSourceState
): DocumentLoadedSourceState => ({
  ...state,
  metadata: state.metadata ? { ...state.metadata } : null,
  fontAssets: [...state.fontAssets],
  preservedSources: [...state.preservedSources]
});

const cloneEditorSession = (session: DocumentEditorState): DocumentEditorState => ({
  activeChannel: session.activeChannel,
  selection: [...session.selection],
  vectorSelection: {
    elements: session.vectorSelection.elements.map((reference) => ({ ...reference })),
    paths: session.vectorSelection.paths.map((reference) => ({ ...reference })),
    anchors: session.vectorSelection.anchors.map((reference) => ({ ...reference })),
    active: session.vectorSelection.active
      ? {
          ...session.vectorSelection.active,
          target: { ...session.vectorSelection.active.target }
        }
      : null
  }
});

/**
 * Application-owned state for one open document.
 *
 * Tool choice and tool options deliberately do not live here: those belong to
 * the one application editor. Only document-specific interaction/view state
 * follows a tab.
 */
export class DocumentSession {
  readonly id: DocumentSessionId;
  readonly history: DocumentCommandHistory;
  readonly tasks: DocumentTaskRegistry;
  readonly fonts: DocumentFontRegistry;

  private snapshot: DocumentSessionSnapshot;
  private startupTimeline: DocumentStartupTimeline | null = null;
  private readonly listeners = new Set<DocumentSessionListener>();
  private readonly disposers = new Set<() => void>();
  private readonly unsubscribeHistory: () => void;
  private readonly unsubscribeTasks: () => void;

  constructor(options: CreateDocumentSessionOptions) {
    this.id = options.id;
    this.history = new DocumentCommandHistory(options.id);
    this.tasks = new DocumentTaskRegistry(options.id);
    this.fonts = new DocumentFontRegistry({
      parser: new FontationsFontFaceParser(),
      systemProvider: options.systemFontProvider
    });
    this.disposers.add(() => this.fonts.dispose());
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
      // This is diagnostics/presentation telemetry only. The application owns
      // the single renderer lifecycle and projects it onto the active document.
      renderer: {
        status: 'idle',
        generation: 0,
        active: false,
        estimatedGpuBytes: 0,
        error: null
      },
      document: null,
      editor: cloneEditorSession(options.editor ?? createDocumentEditorState()),
      viewport: { ...(options.viewport ?? DEFAULT_VIEWPORT) },
      processing: cloneProcessingState(options.processing ?? createDefaultProcessingState()),
      loadedSource: {
        metadata: null,
        name: options.source.name,
        blob: null,
        identity: '',
        fontAssets: [],
        preservedSources: []
      }
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
  }

  getSnapshot = (): DocumentSessionSnapshot => this.snapshot;

  setStartupTimeline(timeline: DocumentStartupTimeline): void {
    this.startupTimeline = timeline;
  }

  startupTimelineSnapshot(): DocumentStartupTimelineSnapshot | null {
    return this.startupTimeline?.snapshot() ?? null;
  }

  subscribe = (listener: DocumentSessionListener): (() => void) => {
    // React external-store consumers may reconnect a passive subscription
    // after the owning tab has entered terminal teardown. A disposed session
    // has a stable final snapshot and can never publish again, so subscribing
    // to it is a harmless no-op. Mutations and resource access remain guarded.
    if (this.snapshot.lifecycle === 'disposed') return () => {};
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
    updater: (current: DocumentEditorState) => DocumentEditorState
  ): void {
    this.assertEditable();
    const next = cloneEditorSession(updater(cloneEditorSession(this.snapshot.editor)));
    this.update({ editor: next });
  }

  setDocument(document: ImageDocument | null): void {
    this.assertEditable();
    if (this.snapshot.document === document) return;
    document?.assets.fonts.forEach((asset) => this.fonts.registerReference(asset));
    this.update({ document });
  }

  updateViewport(
    updater: (current: DocumentViewport) => DocumentViewport
  ): void {
    this.assertEditable();
    this.update({
      viewport: { ...updater({ ...this.snapshot.viewport }) }
    });
  }

  updateProcessing(
    updater: (current: DocumentProcessingState) => DocumentProcessingState
  ): void {
    this.assertEditable();
    this.update({
      processing: cloneProcessingState(updater(cloneProcessingState(this.snapshot.processing)))
    });
  }

  updateLoadedSource(
    updater: (current: DocumentLoadedSourceState) => DocumentLoadedSourceState
  ): void {
    this.assertEditable();
    this.update({
      loadedSource: cloneLoadedSourceState(
        updater(cloneLoadedSourceState(this.snapshot.loadedSource))
      )
    });
  }

  /** Publishes diagnostics from the one application-owned presentation engine. */
  publishRendererProjection(renderer: DocumentRendererSnapshot): void {
    this.assertUsable();
    const current = this.snapshot.renderer;
    if (current.status === renderer.status
      && current.generation === renderer.generation
      && current.active === renderer.active
      && current.estimatedGpuBytes === renderer.estimatedGpuBytes
      && current.error === renderer.error) return;
    this.update({ renderer: { ...renderer } });
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
      lifecycle: 'disposed',
      renderer: {
        ...this.snapshot.renderer,
        status: 'disposed',
        active: false,
        estimatedGpuBytes: 0,
        error: null
      }
    };
    this.unsubscribeHistory();
    this.unsubscribeTasks();
    this.history.dispose();
    this.tasks.dispose();
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
