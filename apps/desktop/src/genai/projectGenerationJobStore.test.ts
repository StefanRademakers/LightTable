import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  GenAiAssetId,
  GenAiGenerationJob,
  GenAiJobId,
  GenAiModelId,
  GenAiProviderId,
  GenAiWorkflowId
} from '@lighttable/genai-core';
import { createProjectOnDisk } from '../projectService';
import {
  listProjectGenerationJobs,
  updateProjectGenerationJob,
  upsertProjectGenerationJob
} from './projectGenerationJobStore';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const job = (id: string, updatedAt: number): GenAiGenerationJob => ({
  id: id as GenAiJobId,
  request: {
    providerId: 'openart' as GenAiProviderId,
    modelId: 'nano-banana-pro' as GenAiModelId,
    workflowId: 'nano-banana-pro:text2image' as GenAiWorkflowId,
    prompt: `Prompt ${id}`,
    providerPrompt: `Prompt ${id}`,
    promptBindings: [],
    fields: { prompt: `Prompt ${id}` },
    references: []
  },
  status: 'running',
  createdAt: updatedAt,
  updatedAt,
  results: []
});

describe('project generation job store', () => {
  it('persists jobs privately, updates atomically and restores newest first', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lighttable-genai-jobs-'));
    temporaryRoots.push(root);
    const project = await createProjectOnDisk({ name: 'GenAI Journal', parentPath: root });
    await Promise.all([
      upsertProjectGenerationJob(project.manifestPath, job('older', 10)),
      upsertProjectGenerationJob(project.manifestPath, job('newer', 20))
    ]);

    const completed = await updateProjectGenerationJob(project.manifestPath, 'older' as GenAiJobId, (current) => ({
      ...current,
      status: 'succeeded',
      updatedAt: 30,
      results: [{ assetId: 'asset-result' as GenAiAssetId, mediaType: 'image/png', fileName: 'result.png' }]
    }));

    expect(completed.status).toBe('succeeded');
    await expect(listProjectGenerationJobs(project.manifestPath)).resolves.toMatchObject([
      { id: 'older', status: 'succeeded', results: [{ fileName: 'result.png' }] },
      { id: 'newer', status: 'running' }
    ]);
  });
});
