export const LIGHTTABLE_PREFERENCES_STORAGE_KEY = 'lighttable:preferences';

export interface ApplicationPreferences {
  readonly version: 1;
  readonly autosave: {
    readonly enabled: boolean;
    readonly intervalMs: number;
  };
}

export const DEFAULT_APPLICATION_PREFERENCES: ApplicationPreferences = {
  version: 1,
  autosave: {
    enabled: true,
    intervalMs: 30_000
  }
};

const AUTOSAVE_INTERVALS = new Set([30_000, 60_000, 120_000, 300_000, 600_000]);

export const parseApplicationPreferences = (value: unknown): ApplicationPreferences => {
  if (!value || typeof value !== 'object') return DEFAULT_APPLICATION_PREFERENCES;
  const candidate = value as Partial<ApplicationPreferences>;
  if (candidate.version !== 1 || !candidate.autosave
    || typeof candidate.autosave.enabled !== 'boolean'
    || !AUTOSAVE_INTERVALS.has(candidate.autosave.intervalMs)) {
    return DEFAULT_APPLICATION_PREFERENCES;
  }
  return {
    version: 1,
    autosave: {
      enabled: candidate.autosave.enabled,
      intervalMs: candidate.autosave.intervalMs
    }
  };
};

export const loadApplicationPreferences = (
  storage: Pick<Storage, 'getItem'> = localStorage
): ApplicationPreferences => {
  try {
    const value = storage.getItem(LIGHTTABLE_PREFERENCES_STORAGE_KEY);
    return value ? parseApplicationPreferences(JSON.parse(value)) : DEFAULT_APPLICATION_PREFERENCES;
  } catch {
    return DEFAULT_APPLICATION_PREFERENCES;
  }
};

export const saveApplicationPreferences = (
  preferences: ApplicationPreferences,
  storage: Pick<Storage, 'setItem'> = localStorage
): void => storage.setItem(LIGHTTABLE_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
