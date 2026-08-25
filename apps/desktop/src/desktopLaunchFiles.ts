import path from 'node:path';
import { desktopMediaTypeForFileName } from './desktopFileFormats';

const canonical = (value: string) => {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved;
};

const isSupportedDesktopLaunchFile = (filePath: string): boolean =>
  desktopMediaTypeForFileName(filePath) !== '';

/** Extracts supported absolute document paths from OS process arguments. */
export const desktopLaunchFilesFromArgv = (argv: readonly string[]): string[] => {
  const seen = new Set<string>();
  const files: string[] = [];
  for (const argument of argv) {
    if (typeof argument !== 'string' || !path.isAbsolute(argument)) continue;
    if (!isSupportedDesktopLaunchFile(argument)) continue;
    const key = canonical(argument);
    if (seen.has(key)) continue;
    seen.add(key);
    files.push(path.resolve(argument));
  }
  return files;
};

export interface PreparedDesktopLaunchFile<T> {
  readonly filePath: string;
  readonly payload: Promise<T>;
}

interface PendingDesktopLaunchFile<T> {
  readonly filePath: string;
  payload: Promise<T> | null;
}

/**
 * Durable, bounded in-process handoff between OS launch events and renderer
 * readiness. Once a loader is configured, accepted paths begin I/O immediately
 * while Electron continues creating the first window.
 */
export class DesktopLaunchFileQueue<T = never> {
  private readonly pending = new Map<string, PendingDesktopLaunchFile<T>>();
  private loader: ((filePath: string) => Promise<T>) | null = null;

  constructor(private readonly capacity = 8) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error('Desktop launch-file capacity must be a positive integer.');
    }
  }

  configureLoader(loader: (filePath: string) => Promise<T>): void {
    if (this.loader) throw new Error('Desktop launch-file loader is already configured.');
    this.loader = loader;
    for (const entry of this.pending.values()) this.prepare(entry);
  }

  private prepare(entry: PendingDesktopLaunchFile<T>): void {
    if (!entry.payload && this.loader) {
      entry.payload = this.loader(entry.filePath);
      // The renderer may not claim the queue until well after an early read
      // failed. Mark the promise handled now while preserving its rejection
      // for the eventual consumer.
      void entry.payload.catch(() => undefined);
    }
  }

  enqueue(filePaths: readonly string[]): number {
    for (const filePath of filePaths) {
      if (!path.isAbsolute(filePath) || !isSupportedDesktopLaunchFile(filePath)) continue;
      const key = canonical(filePath);
      if (this.pending.has(key) || this.pending.size >= this.capacity) continue;
      const entry: PendingDesktopLaunchFile<T> = {
        filePath: path.resolve(filePath),
        payload: null
      };
      this.pending.set(key, entry);
      this.prepare(entry);
    }
    return this.pending.size;
  }

  takeAll(): string[] {
    const files = [...this.pending.values()].map(({ filePath }) => filePath);
    this.pending.clear();
    return files;
  }

  takeAllPrepared(): PreparedDesktopLaunchFile<T>[] {
    if (!this.loader) throw new Error('Desktop launch-file loader is not configured.');
    const files = [...this.pending.values()].map((entry) => {
      this.prepare(entry);
      return { filePath: entry.filePath, payload: entry.payload! };
    });
    this.pending.clear();
    return files;
  }

  get size() { return this.pending.size; }
}
