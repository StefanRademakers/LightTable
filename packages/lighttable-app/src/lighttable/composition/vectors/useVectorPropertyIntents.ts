import { useMemo, useRef } from 'react';
import { VectorPropertyIntents, type VectorPropertyPorts } from '../../application/vectors/VectorPropertyIntents';

export const useVectorPropertyIntents = (ports: VectorPropertyPorts) => {
  const latest = useRef(ports);
  latest.current = ports;
  return useMemo(() => new VectorPropertyIntents(() => latest.current), []);
};
