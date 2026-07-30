import type { DocumentSessionId } from '../documents/documentSession';

export type DocumentTaskKind =
  | 'open'
  | 'save'
  | 'export'
  | 'import'
  | 'analysis'
  | 'thumbnail';

export type DocumentTaskStatus =
  | 'running'
  | 'completed'
  | 'canceled'
  | 'failed';

export interface DocumentTaskState {
  readonly id: string;
  readonly documentId: DocumentSessionId;
  readonly kind: DocumentTaskKind;
  readonly label: string;
  readonly status: DocumentTaskStatus;
  readonly progress: number | null;
  readonly error: string | null;
  readonly startedAt: number;
  readonly finishedAt: number | null;
}

export interface DocumentTaskRegistrySnapshot {
  readonly documentId: DocumentSessionId;
  readonly tasks: Readonly<Record<string, DocumentTaskState>>;
  readonly activeTaskIds: readonly string[];
}

export interface DocumentTaskContext {
  readonly id: string;
  readonly documentId: DocumentSessionId;
  readonly kind: DocumentTaskKind;
  readonly signal: AbortSignal;
  isCurrent(): boolean;
  throwIfCanceled(): void;
  reportProgress(progress: number | null): void;
}

export type DocumentTaskResult<T> =
  | { readonly status: 'completed'; readonly value: T }
  | { readonly status: 'canceled' }
  | { readonly status: 'failed'; readonly error: Error };

export interface RunDocumentTaskOptions {
  readonly replace?: boolean;
}

export type DocumentTaskRegistryListener = (
  snapshot: DocumentTaskRegistrySnapshot
) => void;

interface RunningTask {
  readonly state: DocumentTaskState;
  readonly controller: AbortController;
  readonly generation: number;
}

const asError = (reason: unknown) =>
  reason instanceof Error ? reason : new Error(String(reason));

/**
 * Owns cancelable asynchronous work for exactly one document.
 *
 * Results can only be committed while `isCurrent()` is true. Replacing a task
 * kind aborts its predecessor and invalidates late results even when an
 * underlying browser API ignores AbortSignal.
 */
export class DocumentTaskRegistry {
  readonly documentId: DocumentSessionId;

  private readonly listeners = new Set<DocumentTaskRegistryListener>();
  private readonly running = new Map<string, RunningTask>();
  private readonly latestByKind = new Map<DocumentTaskKind, string>();
  private states = new Map<string, DocumentTaskState>();
  private sequence = 0;
  private generation = 0;
  private disposed = false;
  private snapshot: DocumentTaskRegistrySnapshot;

  constructor(documentId: DocumentSessionId) {
    this.documentId = documentId;
    this.snapshot = this.buildSnapshot();
  }

  getSnapshot = (): DocumentTaskRegistrySnapshot => this.snapshot;

  subscribe = (listener: DocumentTaskRegistryListener): (() => void) => {
    this.assertUsable();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async run<T>(
    kind: DocumentTaskKind,
    label: string,
    operation: (context: DocumentTaskContext) => Promise<T>,
    options: RunDocumentTaskOptions = {}
  ): Promise<DocumentTaskResult<T>> {
    this.assertUsable();
    if (options.replace !== false) this.cancelKind(kind);

    this.sequence += 1;
    const id = `${this.documentId}:${kind}:${this.sequence}`;
    const generation = ++this.generation;
    const controller = new AbortController();
    const state: DocumentTaskState = {
      id,
      documentId: this.documentId,
      kind,
      label,
      status: 'running',
      progress: null,
      error: null,
      startedAt: performance.now(),
      finishedAt: null
    };
    const running: RunningTask = { state, controller, generation };
    this.running.set(id, running);
    this.latestByKind.set(kind, id);
    this.states.set(id, state);
    this.publish();

    const isCurrent = () => (
      !this.disposed
      && !controller.signal.aborted
      && this.running.get(id)?.generation === generation
      && this.latestByKind.get(kind) === id
    );
    const context: DocumentTaskContext = {
      id,
      documentId: this.documentId,
      kind,
      signal: controller.signal,
      isCurrent,
      throwIfCanceled: () => {
        if (!isCurrent()) throw new DOMException('The task was canceled.', 'AbortError');
      },
      reportProgress: (progress) => {
        if (!isCurrent()) return;
        const next = {
          ...this.states.get(id)!,
          progress: progress === null
            ? null
            : Math.min(1, Math.max(0, progress))
        };
        this.states.set(id, next);
        this.publish();
      }
    };

    try {
      const value = await operation(context);
      if (!isCurrent()) {
        this.finish(id, 'canceled');
        return { status: 'canceled' };
      }
      this.finish(id, 'completed');
      return { status: 'completed', value };
    } catch (reason) {
      if (controller.signal.aborted || !isCurrent()) {
        this.finish(id, 'canceled');
        return { status: 'canceled' };
      }
      const error = asError(reason);
      this.finish(id, 'failed', error.message);
      return { status: 'failed', error };
    }
  }

  cancelKind(kind: DocumentTaskKind): void {
    const id = this.latestByKind.get(kind);
    if (id) this.cancel(id);
  }

  cancel(id: string): void {
    const task = this.running.get(id);
    if (!task) return;
    task.controller.abort();
    this.finish(id, 'canceled');
  }

  clearFinished(): void {
    for (const [id, state] of this.states) {
      if (state.status !== 'running') this.states.delete(id);
    }
    this.publish();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const task of this.running.values()) task.controller.abort();
    this.running.clear();
    this.latestByKind.clear();
    this.states.clear();
    this.publish();
    this.listeners.clear();
  }

  private finish(
    id: string,
    status: Exclude<DocumentTaskStatus, 'running'>,
    error: string | null = null
  ): void {
    const current = this.states.get(id);
    if (!current || current.status !== 'running') return;
    this.states.set(id, {
      ...current,
      status,
      error,
      progress: status === 'completed' ? 1 : current.progress,
      finishedAt: performance.now()
    });
    this.running.delete(id);
    if (this.latestByKind.get(current.kind) === id) {
      this.latestByKind.delete(current.kind);
    }
    this.publish();
  }

  private buildSnapshot(): DocumentTaskRegistrySnapshot {
    return {
      documentId: this.documentId,
      tasks: Object.fromEntries(this.states),
      activeTaskIds: [...this.running.keys()]
    };
  }

  private publish(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of [...this.listeners]) listener(this.snapshot);
  }

  private assertUsable(): void {
    if (this.disposed) {
      throw new Error(`Task registry for ${this.documentId} is disposed.`);
    }
  }
}
