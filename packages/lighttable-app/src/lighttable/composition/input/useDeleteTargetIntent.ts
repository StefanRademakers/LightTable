import { useLayoutEffect, useMemo, useRef } from 'react';
import { DeleteTargetIntent, type DeleteTargetIntentPorts } from '../../application/input/DeleteTargetIntent';

export const useDeleteTargetIntent = (ports: Omit<DeleteTargetIntentPorts, 'isMounted'>) => {
  const latest = useRef(ports), mounted = useRef(false), epoch = useRef(0); latest.current = ports;
  useLayoutEffect(() => { mounted.current = true; epoch.current++;
    return () => { mounted.current = false; epoch.current++; }; }, []);
  return useMemo(() => new DeleteTargetIntent(() => {
    const openingEpoch = epoch.current;
    return { ...latest.current, isMounted: () => mounted.current && epoch.current === openingEpoch };
  }), []);
};
