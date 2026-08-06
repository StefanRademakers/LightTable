import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  betaEventFromDebugMessage,
  createLocalBetaDiagnosticRecorder,
  type LocalBetaDiagnosticSnapshot
} from '../../application/diagnostics/localBetaDiagnostics';
import type { LightTableDebugMessage } from '../debug/debugLog';

const unavailableStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined
};

export interface LocalBetaDiagnosticsController {
  readonly enabled: boolean;
  readonly eventCount: number;
  readonly setEnabled: (enabled: boolean) => void;
  readonly snapshot: () => LocalBetaDiagnosticSnapshot;
}

/** Owns optional local beta-event consent, retention and debug classification. */
export const useLocalBetaDiagnostics = (
  messages: readonly LightTableDebugMessage[]
): LocalBetaDiagnosticsController => {
  const recorder = useMemo(() => createLocalBetaDiagnosticRecorder(
    typeof window === 'undefined' ? unavailableStorage : window.localStorage
  ), []);
  const [enabled, publishEnabled] = useState(() => recorder.enabled());
  const [eventCount, setEventCount] = useState(() => recorder.snapshot().events.length);
  const lastMessageIdRef = useRef(0);

  useEffect(() => {
    const latestId = messages.at(-1)?.id ?? 0;
    if (!enabled) {
      lastMessageIdRef.current = latestId;
      return;
    }
    let recorded = false;
    for (const message of messages) {
      if (message.id <= lastMessageIdRef.current) continue;
      const event = betaEventFromDebugMessage(message);
      if (event) recorded = recorder.record(event) || recorded;
    }
    lastMessageIdRef.current = latestId;
    if (recorded) setEventCount(recorder.snapshot().events.length);
  }, [enabled, messages, recorder]);

  const setEnabled = useCallback((next: boolean) => {
    recorder.setEnabled(next);
    publishEnabled(next);
    setEventCount(recorder.snapshot().events.length);
  }, [recorder]);

  return { enabled, eventCount, setEnabled, snapshot: () => recorder.snapshot() };
};
