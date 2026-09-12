import { useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { ImageDocument } from '../../editor/document/documentTypes';
import { PropertiesInspectorPresentation, type PropertiesPresentationPorts } from '../../application/properties/PropertiesInspectorPresentation';

export const usePropertiesInspectorPresentation = (session: object | undefined, renderer: object | null,
  generation: number, document: ImageDocument | null, capture: PropertiesPresentationPorts['capture']) => {
  const latest = useRef({ session, capture }); latest.current = { session, capture };
  const owner = useMemo(() => new PropertiesInspectorPresentation({
    capture: () => {
      const context = latest.current.capture();
      return { isCurrent: () => latest.current.session === session && context.isCurrent(), reveal: context.reveal };
    }, schedule: callback => requestAnimationFrame(callback), cancel: handle => cancelAnimationFrame(handle)
  }), [session]);
  useLayoutEffect(() => { owner.mount(); return owner.retire; }, [owner, renderer, generation]);
  useLayoutEffect(() => { owner.reconcile(document); }, [owner, document]);
  const target = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  return { owner, target, targetRef: owner.targetRef, show: owner.show };
};
