export type LightTableFunnelEvent =
  | 'launcher.viewed'
  | 'guide.started'
  | 'guide.sample-ready'
  | 'guide.shape-created'
  | 'guide.undo-completed'
  | 'guide.redo-completed'
  | 'guide.png-exported'
  | 'guide.psd-exported'
  | 'guide.completed'
  | 'guide.dismissed';

export interface LightTableFunnelTelemetry {
  enabled(): boolean;
  setEnabled(enabled: boolean): void;
  record(event: LightTableFunnelEvent): void;
}

const ENABLED_KEY = 'lighttable.onboarding-telemetry.enabled.v1';
const EVENTS_KEY = 'lighttable.onboarding-telemetry.events.v1';
const EVENT_LIMIT = 100;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const createLocalLightTableFunnelTelemetry = (
  storage: StorageLike,
  now: () => number = Date.now
): LightTableFunnelTelemetry => ({
  enabled: () => {
    try { return storage.getItem(ENABLED_KEY) === 'true'; } catch { return false; }
  },
  setEnabled(enabled) {
    try {
      if (enabled) storage.setItem(ENABLED_KEY, 'true');
      else {
        storage.removeItem(ENABLED_KEY);
        storage.removeItem(EVENTS_KEY);
      }
    } catch { /* Optional local diagnostics must never block the app. */ }
  },
  record(event) {
    try {
      if (storage.getItem(ENABLED_KEY) !== 'true') return;
      const parsed: unknown = JSON.parse(storage.getItem(EVENTS_KEY) ?? '[]');
      const current = Array.isArray(parsed) ? parsed : [];
      storage.setItem(EVENTS_KEY, JSON.stringify([
        ...current.slice(-(EVENT_LIMIT - 1)),
        { event, at: now() }
      ]));
    } catch { /* Telemetry absence/corruption has no product effect. */ }
  }
});
