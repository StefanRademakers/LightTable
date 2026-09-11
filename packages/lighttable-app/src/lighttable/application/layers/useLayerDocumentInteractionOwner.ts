import { useMemo, useRef } from 'react';
import { LayerDocumentInteractionOwner, type LayerDocumentInteractionBinding } from './LayerDocumentInteractionOwner';

/** Stable gesture owner; a host binding replacement must not drop its token. */
export const useLayerDocumentInteractionOwner = (capture: () => LayerDocumentInteractionBinding) => {
  const latest = useRef(capture);
  latest.current = capture;
  return useMemo(() => new LayerDocumentInteractionOwner(() => latest.current()), []);
};
