import type { GenAiGenerationJob } from '@lighttable/genai-core';

/**
 * A provider job may continue remotely after this deadline, but LightTable must
 * not present an unconfirmed generation as "Running" forever. Resuming a job
 * with a known provider ID remains a separate, explicit operation.
 */
export const GEN_AI_TRACKING_TIMEOUT_MS = 30 * 60 * 1_000;

export const generationTrackingTimeRemaining = (
  job: Pick<GenAiGenerationJob, 'updatedAt'>,
  now = Date.now()
): number => Math.max(0, GEN_AI_TRACKING_TIMEOUT_MS - Math.max(0, now - job.updatedAt));

export const generationTrackingTimedOut = (
  job: Pick<GenAiGenerationJob, 'status' | 'updatedAt'>,
  now = Date.now()
): boolean => job.status === 'running' && generationTrackingTimeRemaining(job, now) === 0;

export const generationTrackingTimeoutError = (): Error => {
  const error = new Error(
    'Generation tracking timed out after 30 minutes. The provider job may still complete remotely.'
  );
  error.name = 'GenerationTrackingTimeoutError';
  return error;
};

export const isGenerationTrackingTimeout = (reason: unknown): reason is Error =>
  reason instanceof Error && reason.name === 'GenerationTrackingTimeoutError';
