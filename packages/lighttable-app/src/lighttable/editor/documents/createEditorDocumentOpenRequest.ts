import type {
  DocumentOpenRequest
} from '../../application/documents/documentOpenController';
import type {
  DocumentTaskContext
} from '../../application/tasks/documentTaskRegistry';
import type {
  DisposableDocumentRenderer
} from '../../application/rendering/startDocumentRenderer';
import type {
  DocumentRendererLifecycleBridge,
  EditorDocumentRenderer
} from './createDocumentRendererLifecycleBridge';

export interface EditorDocumentRendererSlot<Renderer> {
  get(): Renderer | null;
  set(renderer: Renderer | null): void;
}

export interface EditorDocumentOpenRequestOptions<
  Renderer extends DisposableDocumentRenderer & EditorDocumentRenderer
> {
  readonly createRenderer: () => Promise<Renderer>;
  readonly resolveSource: (signal: AbortSignal) => Promise<Blob>;
  readonly hydrate: (
    renderer: Renderer,
    source: Blob,
    task: DocumentTaskContext
  ) => Promise<void>;
  readonly rendererSlot: EditorDocumentRendererSlot<Renderer>;
  readonly lifecycleBridge: DocumentRendererLifecycleBridge<Renderer>;
}

/**
 * Builds the renderer/open-controller adapter for one document generation.
 *
 * Renderer publication and retirement are kept symmetrical here so a late
 * discarded renderer can never clear a newer generation's active slot.
 */
export const createEditorDocumentOpenRequest = <
  Renderer extends DisposableDocumentRenderer & EditorDocumentRenderer
>(
  options: EditorDocumentOpenRequestOptions<Renderer>
): DocumentOpenRequest<Renderer> => ({
  createRenderer: options.createRenderer,
  loadSource: options.resolveSource,
  hydrate: options.hydrate,
  onRendererReady: (renderer, elapsedMs) => {
    options.rendererSlot.set(renderer);
    options.lifecycleBridge.onRendererReady(renderer, elapsedMs);
  },
  onRendererDiscarded: (renderer) => {
    if (options.rendererSlot.get() === renderer) {
      options.rendererSlot.set(null);
    }
    options.lifecycleBridge.onRendererDiscarded(renderer);
  },
  onSourceReady: (_source, elapsedMs) => {
    options.lifecycleBridge.onSourceReady(elapsedMs);
  },
  onFailed: options.lifecycleBridge.onFailed,
  onSettled: options.lifecycleBridge.onSettled
});
