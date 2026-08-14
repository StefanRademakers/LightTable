import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { GenAiGenerationJob, GenAiJobId } from '@lighttable/genai-core';
import { atomicWriteFile } from '../atomicFileWriter';
import { openProjectManifest, resolveProjectStoragePath } from '../projectService';

const FORMAT = 'lighttable-genai-jobs';
const VERSION = 1;
const queues = new Map<string, Promise<void>>();
const deletedJobKeys = new Set<string>();
const MAX_DELETED_JOB_KEYS = 2_048;

const manifestKey = (manifestPath: string): string => path.resolve(manifestPath).toLocaleLowerCase('en-US');
const deletedJobKey = (manifestPath: string, jobId: GenAiJobId): string => `${manifestKey(manifestPath)}\0${jobId}`;
const rememberDeletedJob = (manifestPath: string, jobId: GenAiJobId): void => {
  deletedJobKeys.add(deletedJobKey(manifestPath, jobId));
  if (deletedJobKeys.size > MAX_DELETED_JOB_KEYS) {
    const oldest = deletedJobKeys.values().next().value;
    if (oldest) deletedJobKeys.delete(oldest);
  }
};

interface StoredJobs {
  readonly format: typeof FORMAT;
  readonly version: typeof VERSION;
  readonly jobs: readonly GenAiGenerationJob[];
}

const journalPath = async (manifestPath: string): Promise<string> => {
  const { manifest, summary } = await openProjectManifest(manifestPath);
  return path.join(resolveProjectStoragePath(summary.rootPath, manifest, 'indexes'), 'genai-jobs-v1.json');
};

const readJournal = async (manifestPath: string): Promise<StoredJobs> => {
  try {
    const value = JSON.parse(await readFile(await journalPath(manifestPath), 'utf8')) as Partial<StoredJobs>;
    if (value.format !== FORMAT || value.version !== VERSION || !Array.isArray(value.jobs)) {
      return { format: FORMAT, version: VERSION, jobs: [] };
    }
    return { format: FORMAT, version: VERSION, jobs: value.jobs as readonly GenAiGenerationJob[] };
  } catch (reason) {
    if (reason && typeof reason === 'object' && 'code' in reason && reason.code === 'ENOENT') {
      return { format: FORMAT, version: VERSION, jobs: [] };
    }
    throw reason;
  }
};

export const listProjectGenerationJobs = async (
  manifestPath: string
): Promise<readonly GenAiGenerationJob[]> => [...(await readJournal(manifestPath)).jobs]
  .sort((left, right) => right.updatedAt - left.updatedAt);

export const upsertProjectGenerationJob = async (
  manifestPath: string,
  job: GenAiGenerationJob
): Promise<void> => {
  if (deletedJobKeys.has(deletedJobKey(manifestPath, job.id))) return;
  const key = manifestKey(manifestPath);
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    if (deletedJobKeys.has(deletedJobKey(manifestPath, job.id))) return;
    const journal = await readJournal(manifestPath);
    const jobs = journal.jobs.filter(({ id }) => id !== job.id).concat(job).slice(-500);
    await atomicWriteFile({
      targetPath: await journalPath(manifestPath),
      bytes: Buffer.from(`${JSON.stringify({ format: FORMAT, version: VERSION, jobs }, null, 2)}\n`, 'utf8')
    });
  });
  queues.set(key, next);
  try { await next; } finally { if (queues.get(key) === next) queues.delete(key); }
};

export const updateProjectGenerationJob = async (
  manifestPath: string,
  jobId: GenAiJobId,
  update: (job: GenAiGenerationJob) => GenAiGenerationJob
): Promise<GenAiGenerationJob> => {
  const current = (await listProjectGenerationJobs(manifestPath)).find(({ id }) => id === jobId);
  if (!current) throw new Error(`Unknown generation job ${jobId}.`);
  const next = update(current);
  await upsertProjectGenerationJob(manifestPath, next);
  return next;
};

export const deleteProjectGenerationJob = async (
  manifestPath: string,
  jobId: GenAiJobId
): Promise<void> => {
  rememberDeletedJob(manifestPath, jobId);
  const key = manifestKey(manifestPath);
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    const journal = await readJournal(manifestPath);
    await atomicWriteFile({
      targetPath: await journalPath(manifestPath),
      bytes: Buffer.from(`${JSON.stringify({
        format: FORMAT, version: VERSION, jobs: journal.jobs.filter(({ id }) => id !== jobId)
      }, null, 2)}\n`, 'utf8')
    });
  });
  queues.set(key, next);
  try { await next; } finally { if (queues.get(key) === next) queues.delete(key); }
};

export const replaceProjectGenerationAssetId = async (
  manifestPath: string, previousId: string, nextId: string, nextFileName: string
): Promise<void> => {
  const jobs = await listProjectGenerationJobs(manifestPath);
  await Promise.all(jobs.filter((job) => job.results.some(({ assetId }) => assetId === previousId)).map((job) =>
    upsertProjectGenerationJob(manifestPath, {
      ...job,
      results: job.results.map((result) => result.assetId === previousId
        ? { ...result, assetId: nextId as typeof result.assetId, fileName: nextFileName, previewId: nextId }
        : result)
    })));
};
