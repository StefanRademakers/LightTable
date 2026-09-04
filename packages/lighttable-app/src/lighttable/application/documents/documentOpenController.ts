import {
  DocumentRendererLifecycle
} from '../rendering/documentRendererLifecycle';
import {
  startDocumentRenderer,
  type DisposableDocumentRenderer
} from '../rendering/startDocumentRenderer';
import {
  DocumentTaskRegistry,
  type DocumentTaskContext
} from '../tasks/documentTaskRegistry';

export interface DocumentOpenRequest<
  Renderer extends DisposableDocumentRenderer,
  Source = Blob
> {
  readonly createRenderer: () => Promise<Renderer>;
  readonly loadSource: (signal: AbortSignal) => Promise<Source>;
  readonly hydrate: (
    renderer: Renderer,
    source: Source,
    context: DocumentTaskContext
  ) => Promise<void>;
  readonly onRendererReady?: (
    renderer: Renderer,
    elapsedMs: number,
    generation: number
  ) => void;
  readonly onRendererDiscarded?: (renderer: Renderer) => void;
  readonly onSourceReady?: (source: Source, elapsedMs: number) => void;
  readonly disposeSource?: (source: Source) => void;
  readonly onFailed?: (error: Error) => void;
  readonly onSettled?: () => void;
}

export interface DocumentOpenOptions {
  readonly reuseRenderer?: boolean;
}

/**
 * Owns renderer startup and teardown for one document session.
 *
 * The controller keeps late async results from crossing document generations.
 * It deliberately knows nothing about React, WebGPU or either host shell.
 */
export class DocumentOpenController<
  Renderer extends DisposableDocumentRenderer
> {
  private readonly tasks: DocumentTaskRegistry;
  private readonly lifecycle: DocumentRendererLifecycle;
  private renderer: Renderer | null = null;
  private generation = 0;
  private token = 0;

  constructor(
    tasks: DocumentTaskRegistry,
    lifecycle: DocumentRendererLifecycle
  ) {
    this.tasks = tasks;
    this.lifecycle = lifecycle;
  }

  getRenderer(): Renderer | null {
    return this.renderer;
  }

  async open<Source = Blob>(
    request: DocumentOpenRequest<Renderer, Source>,
    options: DocumentOpenOptions = {}
  ): Promise<void> {
    // Reusing the presentation engine is safe only after the previous source
    // transaction has settled. A canceled decoder may still be unwinding an
    // already-started layer-asset upload even though its result can no longer
    // publish. Letting a newer document mutate that same renderer concurrently
    // makes GPU ownership depend on promise timing. In that uncommon overlap,
    // retire the engine and start clean; ordinary settled tab switches retain
    // the fast renderer-reuse path.
    const openInFlight = this.tasks.getSnapshot().activeTaskIds.some((id) =>
      this.tasks.getSnapshot().tasks[id]?.kind === 'open'
    );
    const reusableRenderer = options.reuseRenderer && !openInFlight
      ? this.renderer
      : null;
    if (reusableRenderer) this.cancelOpen();
    else this.close();
    const token = ++this.token;
    const generation = this.lifecycle.beginStart();
    this.generation = generation;

    const result = await this.tasks.run(
      'open',
      'Open image',
      async (task) => {
        const isCanceled = () => token !== this.token || !task.isCurrent();
        if (reusableRenderer) {
          request.onRendererReady?.(reusableRenderer, 0, generation);
          const sourceStartedAt = performance.now();
          const source = await request.loadSource(task.signal);
          let consumed = false;
          try {
            if (isCanceled()) task.throwIfCanceled();
            request.onSourceReady?.(source, performance.now() - sourceStartedAt);
            await request.hydrate(reusableRenderer, source, task);
            if (isCanceled()) task.throwIfCanceled();
            consumed = true;
          } finally {
            if (!consumed) request.disposeSource?.(source);
          }
          return reusableRenderer;
        }
        const renderer = await startDocumentRenderer({
          createRenderer: request.createRenderer,
          loadSource: () => request.loadSource(task.signal),
          hydrate: (created, source) =>
            request.hydrate(created, source, task),
          isCanceled,
          onRendererReady: (created, elapsedMs) => {
            request.onRendererReady?.(created, elapsedMs, generation);
          },
          onRendererDiscarded: request.onRendererDiscarded,
          onSourceReady: request.onSourceReady,
          disposeSource: request.disposeSource
        });
        task.throwIfCanceled();
        return renderer;
      }
    );

    if (token !== this.token) return;
    if (result.status === 'completed') {
      this.renderer = result.value;
      this.lifecycle.markReady(generation);
    } else if (result.status === 'failed') {
      this.lifecycle.markFailed(generation, result.error.message);
      request.onFailed?.(result.error);
    }
    request.onSettled?.();
  }

  close(): void {
    this.cancelOpen();
    const renderer = this.renderer;
    this.renderer = null;
    renderer?.destroy();
  }

  /** Cancels only source/hydration work while retaining the presentation engine. */
  cancelOpen(): void {
    this.token += 1;
    this.tasks.cancelKind('open');
    if (this.generation) {
      this.lifecycle.reset(this.generation);
      this.generation = 0;
    }
  }
}
