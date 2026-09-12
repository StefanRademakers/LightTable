import { useLayoutEffect, useMemo, useRef } from 'react';
import { TextPropertyCommandController, type TextPropertyCommandPorts } from '../../application/text/TextPropertyCommandController';

export const useTextPropertyCommands = (documentIdentity: object | string, ports: TextPropertyCommandPorts, open: boolean) => {
  const latest = useRef({ ports, documentIdentity, open }), mounted = useRef(false), epoch = useRef(0);
  latest.current = { ports, documentIdentity, open };
  const controller = useMemo(() => new TextPropertyCommandController(() => {
    const opening = latest.current;
    return { ...opening.ports, captureScope: () => {
      const scope = opening.ports.captureScope(), openingEpoch = epoch.current;
      const isCurrent = () => mounted.current && latest.current.open && opening.open && epoch.current === openingEpoch
        && latest.current.documentIdentity === opening.documentIdentity && scope.isCurrent();
      return { isCurrent, assertCurrent: () => { if (!isCurrent()) throw new Error('The text properties presentation was retired.'); } };
    } };
  }), []);
  useLayoutEffect(() => {
    mounted.current = open; epoch.current++;
    return () => { mounted.current = false; epoch.current++; controller.cancelPending(); };
  }, [controller, documentIdentity, open]);
  return controller;
};
