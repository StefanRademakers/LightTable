import { useMemo, useRef } from 'react';
import { TextPointerRouter, type TextPointerPorts } from '../../application/text/TextPointerRouter';

export const useTextPointerRouter = (ports: TextPointerPorts) => {
  const latest = useRef(ports); latest.current = ports;
  return useMemo(() => new TextPointerRouter(() => latest.current), []);
};
