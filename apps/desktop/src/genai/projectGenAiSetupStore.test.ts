import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { GenAiModelId } from '@lighttable/genai-core';
import { createProjectOnDisk } from '../projectService';
import { loadProjectGenAiSetup, saveProjectGenAiSetup } from './projectGenAiSetupStore';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('project GenAI setup store', () => {
  it('roundtrips renderer-safe setup state in private project metadata', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lighttable-genai-setup-'));
    roots.push(root);
    const project = await createProjectOnDisk({ name: 'Setup', parentPath: root });
    await expect(loadProjectGenAiSetup(project.manifestPath)).resolves.toBeNull();
    await saveProjectGenAiSetup(project.manifestPath, {
      modelId: 'gpt-image-2' as GenAiModelId,
      mode: 'text2image',
      values: { prompt: 'A precise test', quality: 'high' },
      updatedAt: 123
    });
    await expect(loadProjectGenAiSetup(project.manifestPath)).resolves.toMatchObject({
      modelId: 'gpt-image-2', mode: 'text2image', values: { quality: 'high' }
    });
  });
});
