import { useLayoutEffect, useMemo, useRef } from 'react';
import { TextPropertyCommandController, type TextPropertyCommandPorts } from '../../application/text/TextPropertyCommandController';

export const useTextPropertyCommands = (documentIdentity: object | string, ports: TextPropertyCommandPorts) => {
  const latest = useRef(ports); latest.current = ports;
  const controller = useMemo(() => new TextPropertyCommandController(() => latest.current), []);
  useLayoutEffect(() => () => controller.cancelPending(), [controller, documentIdentity]);
  return controller;
};
