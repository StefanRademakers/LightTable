import { mkdir, mkdtemp, rm } from 'node:fs/promises';
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
  deleteProjectGenerationJob,
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
    const rootPath = path.join(root, 'GenAI Journal');
    await mkdir(rootPath);
    const project = await createProjectOnDisk({ rootPath });
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

  it('deletes a running job that has no saved result', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lighttable-genai-jobs-'));
    temporaryRoots.push(root);
    const rootPath = path.join(root, 'GenAI Delete');
    await mkdir(rootPath);
    const project = await createProjectOnDisk({ rootPath });
    await upsertProjectGenerationJob(project.manifestPath, job('unfinished', 10));

    await deleteProjectGenerationJob(project.manifestPath, 'unfinished' as GenAiJobId);

    await expect(listProjectGenerationJobs(project.manifestPath)).resolves.toEqual([]);
  });

  it('does not resurrect a deleted job through a late provider update', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lighttable-genai-jobs-'));
    temporaryRoots.push(root);
    const rootPath = path.join(root, 'GenAI Late Update');
    await mkdir(rootPath);
    const project = await createProjectOnDisk({ rootPath });
    const running = job('late-result', 10);
    await upsertProjectGenerationJob(project.manifestPath, running);
    await deleteProjectGenerationJob(project.manifestPath, running.id);

    await upsertProjectGenerationJob(project.manifestPath, { ...running, status: 'succeeded', updatedAt: 20 });

    await expect(listProjectGenerationJobs(project.manifestPath)).resolves.toEqual([]);
  });
});
