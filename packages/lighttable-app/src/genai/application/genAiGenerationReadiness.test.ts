import { describe, expect, it } from 'vitest';
import { resolveGenAiGenerationReadiness } from './genAiGenerationReadiness';

const readyInput = {
  serviceAvailable: true,
  projectId: 'project-a',
  workflowReady: true,
  prompt: 'Make the pig dance',
  validationIssues: [],
  missingMentionCount: 0,
  tooManyReferences: false,
  generating: false
} as const;

describe('resolveGenAiGenerationReadiness', () => {
  it('reports the first actionable reason instead of only disabling generation', () => {
    expect(resolveGenAiGenerationReadiness({ ...readyInput, projectId: undefined }))
      .toEqual({ code: 'project-required', ready: false, message: 'Open a project before generating.' });
    expect(resolveGenAiGenerationReadiness({ ...readyInput, workflowReady: false }).code)
      .toBe('workflow-loading');
    expect(resolveGenAiGenerationReadiness({ ...readyInput, prompt: ' ' }).code)
      .toBe('prompt-required');
    expect(resolveGenAiGenerationReadiness({
      ...readyInput,
      validationIssues: [{ field: 'visualReferences', message: 'Visual references is required.' }]
    })).toMatchObject({ code: 'invalid-fields', message: 'Visual references is required.' });
  });

  it('is ready only when every submission boundary is satisfied', () => {
    expect(resolveGenAiGenerationReadiness(readyInput)).toEqual({ code: 'ready', ready: true });
    expect(resolveGenAiGenerationReadiness({ ...readyInput, generating: true }).code).toBe('generating');
  });
});
