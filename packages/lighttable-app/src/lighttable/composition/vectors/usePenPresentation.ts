import { useLayoutEffect, useMemo, useRef } from 'react';
import { PenPresentationBinding, type PenPresentationRenderer } from '../../application/vectors/PenPresentationBinding';
import type { VectorToolSessionController } from '../../application/vectors/VectorToolSessionController';
import type { VectorRuntimeScope } from '../../application/vectors/VectorRuntimeBinding';

export const usePenPresentation = (controller: VectorToolSessionController,
  renderer: PenPresentationRenderer | null, session: object | undefined,
  generation: number, lifecycle: object, captureScope: () => VectorRuntimeScope) => {
  const currentSession = useRef(session); currentSession.current = session;
  const binding = useMemo(() => {
    const scope = captureScope();
    return new PenPresentationBinding(controller, renderer, {
      isCurrent: () => currentSession.current === session && scope.isCurrent()
    });
  }, [controller, renderer, session, generation, lifecycle, captureScope]);
  useLayoutEffect(() => { binding.mount(); return binding.unmount; }, [binding]);
  return binding;
};
