import { useLayoutEffect, useRef } from 'react';
import { GuideGridPresentationBinding, type GuideDraftSource, type GuideGridPresentationInputs,
  type GuideGridRenderer } from '../../application/tools/snapping/GuideGridPresentationBinding';

/** Binds two retained frame slots; only the child guide UI subscribes to pointer-rate drafts. */
export const useGuideGridPresentation = (renderer: GuideGridRenderer | null, session: object | undefined,
  generation: number, lifecycle: object, captureScope: () => { isCurrent(): boolean },
  drafts: GuideDraftSource, read: () => GuideGridPresentationInputs,
  getRenderer: () => GuideGridRenderer | null) => {
  const latest = useRef({ session, read, getRenderer }); latest.current = { session, read, getRenderer };
  const retained = useRef<GuideGridPresentationBinding | null>(null);
  useLayoutEffect(() => {
    const scope = captureScope();
    const binding = new GuideGridPresentationBinding(renderer,
      () => latest.current.session === session && latest.current.getRenderer() === renderer && scope.isCurrent(),
      () => latest.current.read(), drafts);
    retained.current = binding; binding.mount();
    return () => { binding.unmount(); if (retained.current === binding) retained.current = null; };
  }, [renderer, session, generation, lifecycle, captureScope, drafts]);
  const input = read();
  useLayoutEffect(() => { retained.current?.present(); }, [renderer, session, generation, lifecycle,
    input.document?.guides, input.document?.width, input.document?.height,
    input.guidesVisible, input.gridVisible, input.gridSpacing, input.gridOriginX, input.gridOriginY, input.zoom]);
};
