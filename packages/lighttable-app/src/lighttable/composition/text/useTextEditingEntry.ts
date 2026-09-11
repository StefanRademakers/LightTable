import { useLayoutEffect, useMemo, useRef } from 'react';
import { TextEditingEntry, type TextEditingEntryPorts } from '../../application/text/TextEditingEntry';

export const useTextEditingEntry = (identity: object | string, tool: string, generation: number,
  registry: object, ports: TextEditingEntryPorts) => {
  const latest = useRef(ports); latest.current = ports;
  const owner = useMemo(() => new TextEditingEntry(() => latest.current), []);
  useLayoutEffect(() => () => owner.cancel(), [owner, identity, generation, registry]);
  useLayoutEffect(() => owner.observeTool(tool), [owner, tool]);
  return owner;
};
