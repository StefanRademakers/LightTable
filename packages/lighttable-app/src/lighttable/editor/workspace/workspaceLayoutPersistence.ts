import type { SerializedDockview } from 'dockview-react';

export const LIGHTTABLE_WORKSPACE_LAYOUT_VERSION = 2;
export const LIGHTTABLE_WORKSPACE_STORAGE_KEY = 'lighttable.workspace.layout.v8';
export const LIGHTTABLE_WORKSPACE_LEGACY_KEYS = [
  'lighttable.workspace.layout.v5',
  'lighttable.workspace.layout.v7'
] as const;

export type LightTableWorkspacePreset =
  | 'default'
  | 'photo-edit'
  | 'grading'
  | 'ai-generation'
  | 'custom';

export interface PersistedLightTableWorkspace {
  readonly version: typeof LIGHTTABLE_WORKSPACE_LAYOUT_VERSION;
  readonly preset: LightTableWorkspacePreset;
  readonly layout: SerializedDockview;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

export const sanitizeWorkspaceLayout = (layout: SerializedDockview): SerializedDockview => {
  const clone = structuredClone(layout);
  if (!isRecord(clone.panels)) throw new Error('Workspace panels are invalid.');
  Object.values(clone.panels).forEach((panel) => {
    if (!isRecord(panel)) throw new Error('Workspace panel entry is invalid.');
    const params = isRecord(panel.params) ? panel.params : {};
    panel.params = typeof params.contentKey === 'string'
      ? { contentKey: params.contentKey }
      : {};
  });
  return clone;
};
const parseCurrent = (raw: string): PersistedLightTableWorkspace | null => {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)
    || parsed.version !== LIGHTTABLE_WORKSPACE_LAYOUT_VERSION
    || (parsed.preset !== 'default'
      && parsed.preset !== 'photo-edit'
      && parsed.preset !== 'grading'
      && parsed.preset !== 'ai-generation'
      && parsed.preset !== 'custom')
    || !isRecord(parsed.layout)) return null;
  return {
    version: LIGHTTABLE_WORKSPACE_LAYOUT_VERSION,
    preset: parsed.preset,
    layout: sanitizeWorkspaceLayout(parsed.layout as unknown as SerializedDockview)
  };
};

export const persistWorkspaceLayout = (
  storage: StorageLike,
  layout: SerializedDockview,
  preset: LightTableWorkspacePreset
): void => {
  const value: PersistedLightTableWorkspace = {
    version: LIGHTTABLE_WORKSPACE_LAYOUT_VERSION,
    preset,
    layout: sanitizeWorkspaceLayout(layout)
  };
  storage.setItem(LIGHTTABLE_WORKSPACE_STORAGE_KEY, JSON.stringify(value));
};

export const readWorkspaceLayout = (storage: StorageLike): PersistedLightTableWorkspace | null => {
  const current = storage.getItem(LIGHTTABLE_WORKSPACE_STORAGE_KEY);
  if (current) {
    try {
      const parsed = parseCurrent(current);
      if (parsed) return parsed;
    } catch {
      // The reset below is the recovery path for corrupt persisted state.
    }
    storage.removeItem(LIGHTTABLE_WORKSPACE_STORAGE_KEY);
  }

  for (const legacyKey of LIGHTTABLE_WORKSPACE_LEGACY_KEYS) {
    const legacy = storage.getItem(legacyKey);
    if (!legacy) continue;
    // The contextual Properties panel deliberately replaces three old tabs.
    // Old Dockview graphs do not have a meaningful one-to-one migration.
    storage.removeItem(legacyKey);
  }
  return null;
};

export const clearWorkspaceLayout = (storage: StorageLike): void => {
  storage.removeItem(LIGHTTABLE_WORKSPACE_STORAGE_KEY);
  LIGHTTABLE_WORKSPACE_LEGACY_KEYS.forEach((key) => storage.removeItem(key));
};
