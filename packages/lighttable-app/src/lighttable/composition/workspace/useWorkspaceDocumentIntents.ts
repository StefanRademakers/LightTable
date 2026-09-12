import { useLayoutEffect, useMemo, useRef } from 'react';
import { WorkspaceDocumentIntents, type WorkspaceDocumentIntentPorts } from '../../application/workspace/WorkspaceDocumentIntents';

/** Retained UI intents read fresh host ports; unmount retires callbacks even if the document remains resident. */
export const useWorkspaceDocumentIntents = (ports: Omit<WorkspaceDocumentIntentPorts, 'isMounted'>) => {
  const latest = useRef(ports); latest.current = ports;
  const mounted = useRef(false);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return useMemo(() => new WorkspaceDocumentIntents(() => ({ ...latest.current, isMounted: () => mounted.current })), []);
};
