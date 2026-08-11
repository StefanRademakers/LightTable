import type { GenAiGenerationJob } from '@lighttable/genai-core';

export type GenerationRecoveryAction = 'resume-known-job' | 'mark-ambiguous-submit' | 'none';

/**
 * Restart recovery never repeats a paid submit. Only a stored provider ID may
 * resume polling; an interrupted submit without that ID remains explicit.
 */
export const generationRecoveryAction = (job: GenAiGenerationJob): GenerationRecoveryAction => {
  if (job.status === 'running' && job.providerJobId) return 'resume-known-job';
  if (job.status === 'submitting' && !job.providerJobId) return 'mark-ambiguous-submit';
  return 'none';
};
