import { useLayoutEffect, useRef, type RefObject } from 'react';
import type { DocumentSession } from '../../application/documents/documentSession';
import type { DocumentRendererLifecycle, DocumentRendererSnapshot } from '../../application/rendering/documentRendererLifecycle';
import { DocumentGpuRecoveryController } from '../../application/rendering/DocumentGpuRecoveryController';
import { resolveGpuRecoverySource } from '../../application/rendering/resolveGpuRecoverySource';

interface Options {
  readonly session: DocumentSession | undefined;
  readonly lifecycle: DocumentRendererLifecycle;
  readonly renderer: RefObject<object | null>;
  readonly snapshot: DocumentRendererSnapshot;
  readonly opening: object;
  readonly reportError: (message: string) => void;
  readonly requestReopen: () => void;
}

/** Exact mounted binding; the host retains its existing reopen-generation signal. */
export function useDocumentGpuRecovery(options: Options) {
  const owner = useRef<DocumentGpuRecoveryController | null>(null);
  owner.current ??= new DocumentGpuRecoveryController();
  const latest = useRef(options); latest.current = options;
  useLayoutEffect(() => {
    const { session, lifecycle, opening, reportError, requestReopen } = options;
    const renderer = options.renderer.current;
    const sessionIsLive = () => session?.getSnapshot().lifecycle !== 'disposed' && session?.getSnapshot().lifecycle !== 'closing';
    if (!sessionIsLive() || lifecycle.getSnapshot().status === 'disposed') return;
    return owner.current!.connect({
      session, lifecycle, renderer, reportError, requestReopen,
      getSource: () => resolveGpuRecoverySource(session),
      isCurrent: () => latest.current.session === session && latest.current.lifecycle === lifecycle
        && latest.current.opening === opening && latest.current.renderer.current === renderer
        && sessionIsLive()
    });
  }, [options.session, options.lifecycle, options.opening, options.renderer.current,
    options.snapshot.generation, options.snapshot.status]);
  return owner.current.canReuseRenderer;
}
