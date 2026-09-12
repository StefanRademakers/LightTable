import { useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { GenAiProviderController, type GenAiProviderPreferences, type GenAiProviderService } from './GenAiProviderController';

export const useGenAiProviders = (service: GenAiProviderService | undefined,
  preferences: GenAiProviderPreferences | undefined, reportFailure: (message: string) => void) => {
  const latest = useRef({ service, reportFailure }); latest.current = { service, reportFailure };
  const owner = useMemo(() => new GenAiProviderController(service, preferences,
    () => latest.current.service === service, () => latest.current.reportFailure), [service]);
  useLayoutEffect(owner.start, [owner]);
  useLayoutEffect(() => { owner.setPreferences(preferences); }, [owner, preferences?.createProviderId, preferences?.editProviderId]);
  const snapshot = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  return { ...snapshot, connectSelected: owner.connectSelected,
    connectOpenArt: owner.connectOpenArt, disconnectOpenArt: owner.disconnectOpenArt };
};
