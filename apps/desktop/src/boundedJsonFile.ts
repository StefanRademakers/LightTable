import { readFile, stat } from 'node:fs/promises';

export const readBoundedJsonFile = async (
  filePath: string,
  maximumBytes: number,
  label: string
): Promise<unknown> => {
  const file = await stat(filePath);
  if (!file.isFile() || file.size < 1 || file.size > maximumBytes) {
    throw new Error(`${label} exceeds the ${Math.floor(maximumBytes / (1024 * 1024))} MiB safety limit.`);
  }
  const bytes = await readFile(filePath);
  if (bytes.byteLength !== file.size || bytes.byteLength > maximumBytes) {
    throw new Error(`${label} changed while it was being read.`);
  }
  return JSON.parse(bytes.toString('utf8'));
};
