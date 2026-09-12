import { useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import { TextRenderPresentation, type TextRenderTraceSink } from '../../application/telemetry/TextRenderPresentation';

/** Subscribe before font diagnostics are derived; connect their trace sink once it exists. */
export const useTextRenderPresentation = () => {
  const owner = useMemo(() => new TextRenderPresentation({
    request: callback => window.requestAnimationFrame(callback),
    cancel: handle => window.cancelAnimationFrame(handle)
  }), []);
  const snapshot = useSyncExternalStore(owner.subscribe, owner.getSnapshot);
  return { owner, snapshot };
};

export const useTextRenderPresentationDiagnostics = (owner: TextRenderPresentation, trace: TextRenderTraceSink): void => {
  useLayoutEffect(() => owner.connect(trace), [owner, trace]);
};
