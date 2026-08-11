import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { GenAiProjectSetup } from '@lighttable/genai-core';
import { atomicWriteFile } from '../atomicFileWriter';
import { openProjectManifest, resolveProjectStoragePath } from '../projectService';

const FORMAT = 'lighttable-genai-setup';
const VERSION = 1;

const setupPath = async (manifestPath: string): Promise<string> => {
  const { manifest, summary } = await openProjectManifest(manifestPath);
  return path.join(resolveProjectStoragePath(summary.rootPath, manifest, 'indexes'), 'genai-setup-v1.json');
};

export const loadProjectGenAiSetup = async (manifestPath: string): Promise<GenAiProjectSetup | null> => {
  try {
    const value = JSON.parse(await readFile(await setupPath(manifestPath), 'utf8')) as {
      format?: unknown; version?: unknown; setup?: unknown;
    };
    if (value.format !== FORMAT || value.version !== VERSION || !value.setup || typeof value.setup !== 'object') return null;
    const setup = value.setup as Partial<GenAiProjectSetup>;
    if (typeof setup.modelId !== 'string' || typeof setup.mode !== 'string'
      || !setup.values || typeof setup.values !== 'object' || Array.isArray(setup.values)
      || typeof setup.updatedAt !== 'number') return null;
    return setup as GenAiProjectSetup;
  } catch (reason) {
    if (reason && typeof reason === 'object' && 'code' in reason && reason.code === 'ENOENT') return null;
    throw reason;
  }
};

export const saveProjectGenAiSetup = async (
  manifestPath: string,
  setup: GenAiProjectSetup
): Promise<void> => {
  const encoded = Buffer.from(`${JSON.stringify({ format: FORMAT, version: VERSION, setup }, null, 2)}\n`, 'utf8');
  if (encoded.byteLength > 1024 * 1024) throw new Error('GenAI setup exceeds the 1 MiB project limit.');
  await atomicWriteFile({ targetPath: await setupPath(manifestPath), bytes: encoded });
};
