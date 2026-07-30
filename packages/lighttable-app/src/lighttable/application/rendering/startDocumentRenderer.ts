export interface DisposableDocumentRenderer {
  destroy(): void;
}

export interface StartDocumentRendererRequest<
  Renderer extends DisposableDocumentRenderer
> {
  readonly createRenderer: () => Promise<Renderer>;
  readonly loadSource: () => Promise<Blob>;
  readonly hydrate: (
    renderer: Renderer,
    source: Blob,
    isCanceled: () => boolean
  ) => Promise<void>;
  readonly isCanceled: () => boolean;
  readonly onRendererReady?: (renderer: Renderer, elapsedMs: number) => void;
  readonly onRendererDiscarded?: (renderer: Renderer) => void;
  readonly onSourceReady?: (source: Blob, elapsedMs: number) => void;
  readonly now?: () => number;
}

const cancellationError = () => {
  const error = new Error('Document renderer startup was canceled.');
  error.name = 'AbortError';
  return error;
};

/**
 * Starts the renderer and source download concurrently, then hydrates the
 * renderer exactly once. Any stale or failed start owns its cleanup here, so a
 * React effect or host cannot leak a late GPU renderer.
 */
export const startDocumentRenderer = async <
  Renderer extends DisposableDocumentRenderer
>(
  request: StartDocumentRendererRequest<Renderer>
): Promise<Renderer> => {
  const now = request.now ?? (() => performance.now());
  const pending = { renderer: null as Renderer | null };
  let retained = false;
  const rendererStartedAt = now();
  const rendererPromise = request.createRenderer().then((created) => {
    pending.renderer = created;
    if (request.isCanceled()) {
      created.destroy();
      pending.renderer = null;
      throw cancellationError();
    }
    request.onRendererReady?.(created, now() - rendererStartedAt);
    return created;
  });
  const sourceStartedAt = now();
  const sourcePromise = request.loadSource().then((source) => {
    if (request.isCanceled()) throw cancellationError();
    request.onSourceReady?.(source, now() - sourceStartedAt);
    return source;
  });

  try {
    const [created, source] = await Promise.all([rendererPromise, sourcePromise]);
    if (request.isCanceled()) throw cancellationError();
    await request.hydrate(created, source, request.isCanceled);
    if (request.isCanceled()) throw cancellationError();
    retained = true;
    return created;
  } finally {
    if (!retained) {
      if (pending.renderer) {
        request.onRendererDiscarded?.(pending.renderer);
        pending.renderer.destroy();
        pending.renderer = null;
      } else {
        // The source can fail before a slower renderer finishes. Arrange
        // cleanup without delaying propagation of the source failure.
        void rendererPromise.then((lateRenderer) => {
          request.onRendererDiscarded?.(lateRenderer);
          lateRenderer.destroy();
        }).catch(() => undefined);
      }
    }
  }
};
