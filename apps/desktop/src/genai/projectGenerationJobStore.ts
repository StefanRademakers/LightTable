import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { GenAiGenerationJob, GenAiJobId } from '@lighttable/genai-core';
import { atomicWriteFile } from '../atomicFileWriter';
import { openProjectManifest, resolveProjectStoragePath } from '../projectService';

const FORMAT = 'lighttable-genai-jobs';
const VERSION = 1;
const queues = new Map<string, Promise<void>>();

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
  const key = path.resolve(manifestPath).toLocaleLowerCase('en-US');
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
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
