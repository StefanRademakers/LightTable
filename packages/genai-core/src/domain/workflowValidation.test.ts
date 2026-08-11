import { describe, expect, it } from 'vitest';
import type { GenAiWorkflowDefinition } from './contracts';
import { validateGenAiWorkflowValues } from './workflowValidation';

const workflow = {
  id: 'openart:test:text2image', providerId: 'openart', modelId: 'test',
  label: 'Test', mode: 'text2image', fields: [
    { key: 'prompt', label: 'Prompt', kind: 'string', required: true, advanced: false, sourceSchema: {} },
    { key: 'count', label: 'Count', kind: 'integer', required: false, advanced: false,
      minimum: 1, maximum: 4, sourceSchema: {} },
    { key: 'quality', label: 'Quality', kind: 'enum', required: false, advanced: false,
      options: [{ value: 'high', label: 'High' }], sourceSchema: {} }
  ]
} as unknown as GenAiWorkflowDefinition;

describe('validateGenAiWorkflowValues', () => {
  it('accepts a valid provider form projection', () => {
    expect(validateGenAiWorkflowValues(workflow, { prompt: 'City', count: 2, quality: 'high' })).toEqual([]);
  });

  it('rejects missing, out-of-range and unknown enum values before submit', () => {
    expect(validateGenAiWorkflowValues(workflow, { prompt: '', count: 5, quality: 'ultra' }))
      .toMatchObject([{ field: 'prompt' }, { field: 'count' }, { field: 'quality' }]);
  });
});
