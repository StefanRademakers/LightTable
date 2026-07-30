import { useEffect, useRef } from 'react';
import type { DocumentRendererLifecycle } from '../rendering/documentRendererLifecycle';
import type { DisposableDocumentRenderer } from '../rendering/startDocumentRenderer';
import type { DocumentTaskRegistry } from '../tasks/documentTaskRegistry';
import {
  DocumentOpenController,
  type DocumentOpenRequest
} from './documentOpenController';

export interface DocumentOpenLifecycleContext {
  isCurrent(): boolean;
}

export interface DocumentOpenGenerationGuard {
  readonly context: DocumentOpenLifecycleContext;
  invalidate(): void;
}

export const createDocumentOpenGenerationGuard =
  (): DocumentOpenGenerationGuard => {
    let current = true;
    return {
      context: {
        isCurrent: () => current
      },
      invalidate: () => {
        current = false;
      }
    };
  };

export interface DocumentOpenLifecycleOptions<
  Renderer extends DisposableDocumentRenderer
> {
  readonly enabled: boolean;
  /**
   * An identity created by the composition root from source and surface
   * dependencies. A new identity starts a new document generation.
   */
  readonly generation: object;
  readonly tasks: DocumentTaskRegistry;
  readonly rendererLifecycle: DocumentRendererLifecycle;
  readonly createRequest: (
    context: DocumentOpenLifecycleContext
  ) => DocumentOpenRequest<Renderer> | null;
  readonly beforeOpen?: () => void;
  readonly afterClose?: () => void;
}

/**
 * Binds a host-neutral document open controller to one mounted document view.
 *
 * Callback refs keep ordinary React renders from restarting GPU startup.
 * Only the explicit generation identity may replace the active renderer.
 */
export const useDocumentOpenLifecycle = <
  Renderer extends DisposableDocumentRenderer
>({
  enabled,
  generation,
  tasks,
  rendererLifecycle,
  createRequest,
  beforeOpen,
  afterClose
}: DocumentOpenLifecycleOptions<Renderer>): void => {
  const createRequestRef = useRef(createRequest);
  const beforeOpenRef = useRef(beforeOpen);
  const afterCloseRef = useRef(afterClose);
  createRequestRef.current = createRequest;
  beforeOpenRef.current = beforeOpen;
  afterCloseRef.current = afterClose;

  useEffect(() => {
    if (!enabled) return;
    const controller = new DocumentOpenController<Renderer>(
      tasks,
      rendererLifecycle
    );
    const guard = createDocumentOpenGenerationGuard();
    const request = createRequestRef.current(guard.context);
    if (!request) return;

    beforeOpenRef.current?.();
    void controller.open(request);

    return () => {
      guard.invalidate();
      controller.close();
      afterCloseRef.current?.();
    };
  }, [enabled, generation, rendererLifecycle, tasks]);
};
