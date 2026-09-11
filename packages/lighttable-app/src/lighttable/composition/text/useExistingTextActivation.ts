import { useLayoutEffect, useMemo, useRef } from 'react';
import { ExistingTextActivationController, type ExistingTextActivationPorts } from '../../application/text/ExistingTextActivationController';

export const useExistingTextActivation = (identity: object | string, tool: string, rendererGeneration: number,
  ports: ExistingTextActivationPorts) => {
  const latest = useRef(ports); latest.current = ports;
  const controller = useMemo(() => new ExistingTextActivationController(() => latest.current), []);
  useLayoutEffect(() => () => controller.cancel(), [controller, identity, tool, rendererGeneration]);
  return controller;
};
