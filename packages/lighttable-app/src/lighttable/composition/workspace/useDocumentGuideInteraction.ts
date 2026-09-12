import { useLayoutEffect, useMemo, useRef } from 'react';
import type { DocumentSession } from '../../application/documents/documentSession';
import { DocumentGuideInteraction, type DocumentGuideInteractionPorts } from '../../application/tools/snapping/DocumentGuideInteraction';

export const useDocumentGuideInteraction = (session: DocumentSession | undefined, renderer: object | null,
  lifecycle: object, generation: number, ready: boolean, projectedDocumentId: string | undefined,
  captureScope: () => { isCurrent(): boolean }, ports: Omit<DocumentGuideInteractionPorts, 'capture'> & { getRenderer(): object | null }
) => {
  const latest = useRef({ session, renderer, ready, projectedDocumentId, ports, captureScope });
  latest.current = { session, renderer, ready, projectedDocumentId, ports, captureScope };
  const binding = useMemo(() => {
    let mounted = false;
    const owner = new DocumentGuideInteraction({
      capture: () => {
        const scope = latest.current.captureScope();
        return { getDocument: () => session?.getSnapshot().document ?? null,
          isCurrent: () => mounted && latest.current.session === session && latest.current.renderer === renderer
            && latest.current.ports.getRenderer() === renderer
            && Boolean(renderer && latest.current.ready && session?.getSnapshot().lifecycle === 'ready'
              && latest.current.projectedDocumentId === session.getSnapshot().document?.id) && scope.isCurrent() };
      },
      changeDocument: (...args) => latest.current.ports.changeDocument(...args),
      reportFailure: message => latest.current.ports.reportFailure(message)
    });
    return { owner, mount: () => { mounted = true; }, retire: () => { mounted = false; owner.cancel(); } };
  }, [session, renderer, lifecycle, generation]);
  useLayoutEffect(() => {
    binding.mount(); const unsubscribe = session?.subscribe(binding.owner.synchronize);
    return () => { binding.retire(); unsubscribe?.(); };
  }, [binding, session]);
  useLayoutEffect(binding.owner.synchronize, [binding, ready, projectedDocumentId]);
  return binding.owner;
};
