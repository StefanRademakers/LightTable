export interface PersistedRecentFile {
  id: string;
  path: string;
  openedAt: number;
}

export const RECENT_FILE_LIMIT = 4;

/**
 * Produces one deterministic MRU list. Persisted data can arrive unsorted or
 * contain duplicate paths after an interrupted/older desktop write.
 */
export function normalizeRecentFiles(
  entries: readonly PersistedRecentFile[],
  limit = RECENT_FILE_LIMIT
): PersistedRecentFile[] {
  const newestById = new Map<string, PersistedRecentFile>();
  for (const entry of entries) {
    const current = newestById.get(entry.id);
    if (!current || entry.openedAt > current.openedAt) newestById.set(entry.id, entry);
  }
  return [...newestById.values()]
    .sort((left, right) => right.openedAt - left.openedAt)
    .slice(0, Math.max(0, limit));
}

export function touchRecentFile(
  entries: readonly PersistedRecentFile[],
  opened: PersistedRecentFile,
  limit = RECENT_FILE_LIMIT
): PersistedRecentFile[] {
  return normalizeRecentFiles([
    opened,
    ...entries.filter((entry) => entry.id !== opened.id)
  ], limit);
}
