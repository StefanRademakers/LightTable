import { useLayoutEffect, useMemo, useRef } from 'react';
import { AdjustmentCreationIntents, type AdjustmentCreationIntentPorts } from '../../application/adjustments/AdjustmentCreationIntents';

export const useAdjustmentCreationIntents = (ports: Omit<AdjustmentCreationIntentPorts, 'isMounted'>) => {
  const latest = useRef(ports), mounted = useRef(false), epoch = useRef(0); latest.current = ports;
  useLayoutEffect(() => { mounted.current = true; epoch.current++;
    return () => { mounted.current = false; epoch.current++; }; }, []);
  return useMemo(() => new AdjustmentCreationIntents(() => {
    const openingEpoch = epoch.current;
    return { ...latest.current, isMounted: () => mounted.current && epoch.current === openingEpoch };
  }), []);
};
