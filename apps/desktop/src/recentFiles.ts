export interface PersistedRecentFile {
  id: string;
  path: string;
  openedAt: number;
}

/** Keep a useful history while the launcher and menus render only a small window. */
export const RECENT_FILE_LIMIT = 128;

export const canonicalRecentFilePath = (
  filePath: string,
  platform: NodeJS.Platform = process.platform
): string => {
  const resolved = path.normalize(path.resolve(filePath));
  return platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved;
};

/** Serializes manifest operations while allowing the queue to recover after a failure. */
export class RecentFileOperationQueue {
  private pending: Promise<void> = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation);
    this.pending = result.then(() => undefined, () => undefined);
    return result;
  }

  settled(): Promise<void> {
    return this.pending;
  }
}

/**
 * Produces one deterministic MRU list. Persisted data can arrive unsorted or
 * contain duplicate paths after an interrupted/older desktop write.
 */
export function normalizeRecentFiles<T extends PersistedRecentFile>(
  entries: readonly T[],
  limit = RECENT_FILE_LIMIT
): T[] {
  const newestById = new Map<string, T>();
  for (const entry of entries) {
    const current = newestById.get(entry.id);
    if (!current || entry.openedAt > current.openedAt) newestById.set(entry.id, entry);
  }
  return [...newestById.values()]
    .sort((left, right) => right.openedAt - left.openedAt)
    .slice(0, Math.max(0, limit));
}

export function touchRecentFile<T extends PersistedRecentFile>(
  entries: readonly T[],
  opened: T,
  limit = RECENT_FILE_LIMIT
): T[] {
  return normalizeRecentFiles([
    opened,
    ...entries.filter((entry) => entry.id !== opened.id)
  ], limit);
}
import path from 'node:path';
