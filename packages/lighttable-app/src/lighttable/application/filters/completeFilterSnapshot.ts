import {
  filterDefinition,
  isFilterKind,
  normalizeFilterSettings,
  type FilterKind,
  type FilterSettingsMap
} from '@lighttable/filter-core';

export interface FilterSnapshot<K extends FilterKind = FilterKind> {
  readonly kind: K;
  readonly enabled: boolean;
  readonly settings: FilterSettingsMap[K];
}


const record = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

export const filterSnapshotValuesEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((entry, index) => filterSnapshotValuesEqual(entry, right[index]));
  }
  if (!record(left) || !record(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length
    && keys.every((key) => Object.hasOwn(right, key)
      && filterSnapshotValuesEqual(left[key], right[key]));
};

const transportSafe = (value: unknown): boolean => {
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.length <= 255;
  if (Array.isArray(value)) return value.length <= 64 && value.every(transportSafe);
  return record(value) && Object.keys(value).length <= 64
    && Object.values(value).every(transportSafe);
};

/** Strict exact-shape codec for one complete externally replayable filter value. */
export const parseCompleteFilterSnapshot = (value: unknown): FilterSnapshot | null => {
  if (!record(value) || Object.keys(value).length !== 3
    || !Object.hasOwn(value, 'kind') || !Object.hasOwn(value, 'enabled')
    || !Object.hasOwn(value, 'settings') || !isFilterKind(value.kind)
    || typeof value.enabled !== 'boolean' || !transportSafe(value.settings)) return null;
  const kind = value.kind;
  const expectedKeys = Object.keys(filterDefinition(kind).defaults).sort();
  if (!record(value.settings)
    || !filterSnapshotValuesEqual(Object.keys(value.settings).sort(), expectedKeys)) return null;
  const normalized = normalizeFilterSettings(kind, value.settings);
  if (!filterSnapshotValuesEqual(value.settings, normalized)) return null;
  return { kind, enabled: value.enabled, settings: structuredClone(normalized) };
};

export const filterSnapshot = <K extends FilterKind>(
  kind: K,
  enabled: boolean,
  settings: FilterSettingsMap[K]
): FilterSnapshot<K> => ({ kind, enabled, settings: structuredClone(settings) });
