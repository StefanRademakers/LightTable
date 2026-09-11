import { useLayoutEffect, useMemo, useRef } from 'react';
import { TextCreationInteraction, type TextCreationPorts } from '../../application/text/TextCreationInteraction';

export const useTextCreation = (identity: object | string, tool: string, generation: number,
  registry: object, ports: TextCreationPorts) => {
  const latest = useRef(ports); latest.current = ports;
  const controller = useMemo(() => new TextCreationInteraction(() => latest.current), []);
  useLayoutEffect(() => () => { controller.cancel(); }, [controller, identity, tool, generation, registry]);
  return controller;
};
