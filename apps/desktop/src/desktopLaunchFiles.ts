import path from 'node:path';
import { nativeBitmapFormatForFile } from '@lighttable/app/bitmap-formats';

const canonical = (value: string) => {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved;
};

/** Extracts only supported absolute bitmap paths from OS process arguments. */
export const bitmapLaunchFilesFromArgv = (argv: readonly string[]): string[] => {
  const seen = new Set<string>();
  const files: string[] = [];
  for (const argument of argv) {
    if (typeof argument !== 'string' || !path.isAbsolute(argument)) continue;
    if (!nativeBitmapFormatForFile(argument)) continue;
    const key = canonical(argument);
    if (seen.has(key)) continue;
    seen.add(key);
    files.push(path.resolve(argument));
  }
  return files;
};

/** Durable-in-process handoff between OS launch events and renderer readiness. */
export class DesktopLaunchFileQueue {
  private readonly pending = new Map<string, string>();

  enqueue(filePaths: readonly string[]): number {
    for (const filePath of filePaths) {
      if (!path.isAbsolute(filePath) || !nativeBitmapFormatForFile(filePath)) continue;
      this.pending.set(canonical(filePath), path.resolve(filePath));
    }
    return this.pending.size;
  }

  takeAll(): string[] {
    const files = [...this.pending.values()];
    this.pending.clear();
    return files;
  }

  get size() { return this.pending.size; }
}
