import { useEffect, useMemo, useRef } from 'react';
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
  /** Generation-local health gate for retaining an existing renderer. */
  readonly canReuseRenderer?: () => boolean;
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
  afterClose,
  canReuseRenderer
}: DocumentOpenLifecycleOptions<Renderer>): void => {
  const createRequestRef = useRef(createRequest);
  const beforeOpenRef = useRef(beforeOpen);
  const afterCloseRef = useRef(afterClose);
  const canReuseRendererRef = useRef(canReuseRenderer);
  createRequestRef.current = createRequest;
  beforeOpenRef.current = beforeOpen;
  afterCloseRef.current = afterClose;
  canReuseRendererRef.current = canReuseRenderer;
  const controller = useMemo(
    () => new DocumentOpenController<Renderer>(tasks, rendererLifecycle),
    [rendererLifecycle, tasks]
  );

  useEffect(() => {
    if (!enabled) return;
    const guard = createDocumentOpenGenerationGuard();
    let readinessFrame: number | null = null;
    const startWhenSurfaceIsReady = () => {
      if (!guard.context.isCurrent()) return;
      const request = createRequestRef.current(guard.context);
      if (!request) {
        // Dockview commits the persistent canvas after the editor generation.
        // Wait for that presentation surface without turning its lifecycle into
        // a new document-open identity.
        readinessFrame = window.requestAnimationFrame(startWhenSurfaceIsReady);
        return;
      }
      readinessFrame = null;
      beforeOpenRef.current?.();
      void controller.open(request, {
        reuseRenderer: canReuseRendererRef.current?.() ?? true
      });
    };
    startWhenSurfaceIsReady();

    return () => {
      guard.invalidate();
      if (readinessFrame !== null) window.cancelAnimationFrame(readinessFrame);
      controller.cancelOpen();
    };
  }, [controller, enabled, generation]);

  useEffect(() => () => {
    controller.close();
    afterCloseRef.current?.();
  }, [controller]);
};
