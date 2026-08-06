import type { LightTableDebugMessage } from '../../editor/debug/debugLog';

export type BetaWorkflow = 'startup' | 'import' | 'edit' | 'recovery' | 'export' | 'gpu';
export type BetaOutcome = 'succeeded' | 'failed' | 'canceled' | 'unavailable';
export type BetaDurationBucket = 'under-16ms' | '16-33ms' | '34-100ms' | '101-500ms' | 'over-500ms';
export type BetaFormat = 'native' | 'psd' | 'pdf' | 'png' | 'jpeg' | 'other';

export type LocalBetaEvent =
  | { readonly kind: 'runtime-stop'; readonly atHour: string; readonly workflow: BetaWorkflow }
  | { readonly kind: 'command-duration'; readonly atHour: string; readonly workflow: BetaWorkflow; readonly duration: BetaDurationBucket }
  | { readonly kind: 'recovery-outcome'; readonly atHour: string; readonly outcome: BetaOutcome }
  | { readonly kind: 'capability-result'; readonly atHour: string; readonly operation: 'import' | 'export'; readonly format: BetaFormat; readonly outcome: BetaOutcome }
  | { readonly kind: 'device-loss'; readonly atHour: string; readonly outcome: 'recovered' | 'stopped' };

type WithoutEventHour<T> = T extends unknown ? Omit<T, 'atHour'> : never;
export type LocalBetaEventInput = WithoutEventHour<LocalBetaEvent>;

export interface LocalBetaDiagnosticSnapshot {
  readonly schemaVersion: 1;
  readonly localOnly: true;
  readonly enabled: boolean;
  readonly events: readonly LocalBetaEvent[];
}

export interface LocalBetaDiagnosticRecorder {
  enabled(): boolean;
  setEnabled(enabled: boolean): void;
  record(event: LocalBetaEventInput): boolean;
  snapshot(): LocalBetaDiagnosticSnapshot;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const ENABLED_KEY = 'lighttable.beta-diagnostics.enabled.v1';
const EVENTS_KEY = 'lighttable.beta-diagnostics.events.v1';
export const LOCAL_BETA_EVENT_LIMIT = 200;

const atHour = (time: number) => new Date(time).toISOString().slice(0, 13) + ':00:00.000Z';

const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): value is T =>
  typeof value === 'string' && allowed.includes(value as T);

const parseEvent = (value: unknown): LocalBetaEvent | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.atHour !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:00:00\.000Z$/u.test(candidate.atHour)) return null;
  const eventHour = candidate.atHour;
  if (candidate.kind === 'runtime-stop'
    && oneOf(candidate.workflow, ['startup', 'import', 'edit', 'recovery', 'export', 'gpu'])) {
    return { kind: candidate.kind, atHour: eventHour, workflow: candidate.workflow };
  }
  if (candidate.kind === 'command-duration'
    && oneOf(candidate.workflow, ['startup', 'import', 'edit', 'recovery', 'export', 'gpu'])
    && oneOf(candidate.duration, ['under-16ms', '16-33ms', '34-100ms', '101-500ms', 'over-500ms'])) {
    return { kind: candidate.kind, atHour: eventHour, workflow: candidate.workflow, duration: candidate.duration };
  }
  if (candidate.kind === 'recovery-outcome'
    && oneOf(candidate.outcome, ['succeeded', 'failed', 'canceled', 'unavailable'])) {
    return { kind: candidate.kind, atHour: eventHour, outcome: candidate.outcome };
  }
  if (candidate.kind === 'capability-result'
    && oneOf(candidate.operation, ['import', 'export'])
    && oneOf(candidate.format, ['native', 'psd', 'pdf', 'png', 'jpeg', 'other'])
    && oneOf(candidate.outcome, ['succeeded', 'failed', 'canceled', 'unavailable'])) {
    return { kind: candidate.kind, atHour: eventHour, operation: candidate.operation,
      format: candidate.format, outcome: candidate.outcome };
  }
  if (candidate.kind === 'device-loss' && oneOf(candidate.outcome, ['recovered', 'stopped'])) {
    return { kind: candidate.kind, atHour: eventHour, outcome: candidate.outcome };
  }
  return null;
};

const readEvents = (storage: StorageLike): LocalBetaEvent[] => {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(EVENTS_KEY) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.map(parseEvent).filter((event): event is LocalBetaEvent => event !== null).slice(-LOCAL_BETA_EVENT_LIMIT)
      : [];
  } catch { return []; }
};

/** Local-only, opt-in event storage. Event types intentionally have no free-text field. */
export const createLocalBetaDiagnosticRecorder = (
  storage: StorageLike,
  now: () => number = Date.now
): LocalBetaDiagnosticRecorder => {
  const enabled = () => {
    try { return storage.getItem(ENABLED_KEY) === 'true'; } catch { return false; }
  };
  return {
  enabled,
  setEnabled(enabled) {
    try {
      if (enabled) storage.setItem(ENABLED_KEY, 'true');
      else {
        storage.removeItem(ENABLED_KEY);
        storage.removeItem(EVENTS_KEY);
      }
    } catch { /* Optional diagnostics may never block editing. */ }
  },
  record(event) {
    try {
      if (storage.getItem(ENABLED_KEY) !== 'true') return false;
      const next = [...readEvents(storage).slice(-(LOCAL_BETA_EVENT_LIMIT - 1)), { ...event, atHour: atHour(now()) }];
      storage.setItem(EVENTS_KEY, JSON.stringify(next));
      return true;
    } catch { return false; }
  },
  snapshot() {
    const isEnabled = enabled();
    return { schemaVersion: 1, localOnly: true, enabled: isEnabled, events: isEnabled ? readEvents(storage) : [] };
  }
  };
};

export const bucketBetaDuration = (durationMs: number): BetaDurationBucket => {
  if (durationMs < 16) return 'under-16ms';
  if (durationMs <= 33) return '16-33ms';
  if (durationMs <= 100) return '34-100ms';
  if (durationMs <= 500) return '101-500ms';
  return 'over-500ms';
};

/** Classifies existing local diagnostics without retaining their free text. */
export const betaEventFromDebugMessage = (
  message: LightTableDebugMessage
): LocalBetaEventInput | null => {
  const source = message.source.toLowerCase();
  const text = message.message.toLowerCase();
  const failed: BetaOutcome = message.severity === 'error' ? 'failed' : 'succeeded';
  if (text.includes('device lost') || source.includes('webgpu device')) {
    return { kind: 'device-loss', outcome: message.severity === 'error' ? 'stopped' : 'recovered' };
  }
  if (source.includes('recovery')) return { kind: 'recovery-outcome', outcome: failed };
  if (source.includes('import')) {
    return { kind: 'capability-result', operation: 'import', format: source.includes('psd') ? 'psd' : 'other', outcome: failed };
  }
  if (source.includes('export')) {
    const format: BetaFormat = text.includes('png') ? 'png' : text.includes('pdf') ? 'pdf' : text.includes('psd') ? 'psd' : 'other';
    return { kind: 'capability-result', operation: 'export', format, outcome: failed };
  }
  if (message.severity === 'error' && source === 'lighttable') {
    return { kind: 'runtime-stop', workflow: 'edit' };
  }
  return null;
};
