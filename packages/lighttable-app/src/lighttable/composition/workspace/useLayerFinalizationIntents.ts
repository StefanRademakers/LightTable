import { useLayoutEffect, useMemo, useRef } from 'react';
import { LayerFinalizationIntents, type LayerFinalizationIntentPorts } from '../../application/layers/LayerFinalizationIntents';

export const useLayerFinalizationIntents = (ports: Omit<LayerFinalizationIntentPorts, 'isMounted'>) => {
  const latest = useRef(ports), mounted = useRef(false), epoch = useRef(0); latest.current = ports;
  useLayoutEffect(() => { mounted.current = true; epoch.current += 1;
    return () => { mounted.current = false; epoch.current += 1; }; }, []);
  return useMemo(() => new LayerFinalizationIntents(() => {
    const openingEpoch = epoch.current;
    return { ...latest.current, isMounted: () => mounted.current && epoch.current === openingEpoch };
  }), []);
};
