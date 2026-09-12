import { useMemo, useRef } from 'react';
import { DocumentFileIntents, type DocumentFileIntentPorts } from '../../application/documents/DocumentFileIntents';

/** Stable UI callbacks resolve request-time ports, never a render-time null renderer. */
export const useDocumentFileIntents = (ports: DocumentFileIntentPorts) => {
  const current = useRef(ports);
  current.current = ports;
  return useMemo(() => new DocumentFileIntents(() => current.current), []);
};
