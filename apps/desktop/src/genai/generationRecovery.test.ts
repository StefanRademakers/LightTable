import { describe, expect, it } from 'vitest';
import type { GenAiGenerationJob } from '@lighttable/genai-core';
import { generationRecoveryAction } from './generationRecovery';

const job = (status: GenAiGenerationJob['status'], providerJobId?: string) => ({
  status, providerJobId
}) as GenAiGenerationJob;

describe('generation restart recovery', () => {
  it('resumes only a running job with a durable provider identifier', () => {
    expect(generationRecoveryAction(job('running', 'remote-1'))).toBe('resume-known-job');
    expect(generationRecoveryAction(job('running'))).toBe('none');
  });

  it('does not repeat an ambiguous paid submit', () => {
    expect(generationRecoveryAction(job('submitting'))).toBe('mark-ambiguous-submit');
    expect(generationRecoveryAction(job('unknown-submit'))).toBe('none');
    expect(generationRecoveryAction(job('succeeded', 'remote-1'))).toBe('none');
  });

  it('marks interrupted pre-submit work as safe-to-repeat but never repeats it automatically', () => {
    expect(generationRecoveryAction(job('queued'))).toBe('mark-interrupted-preparation');
    expect(generationRecoveryAction(job('preparing-inputs'))).toBe('mark-interrupted-preparation');
    expect(generationRecoveryAction(job('ready-to-submit'))).toBe('mark-interrupted-preparation');
  });
});
