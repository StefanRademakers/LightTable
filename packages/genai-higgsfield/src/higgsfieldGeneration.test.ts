import { describe, expect, it } from 'vitest';
import type { GenAiGenerationRequest, GenAiWorkflowDefinition } from '@lighttable/genai-core';
import { buildHiggsfieldGenerationParams, extractHiggsfieldGenerationId, normalizeHiggsfieldCompletion } from './higgsfieldGeneration';

const workflow = { fields: [{ key: 'prompt', role: 'prompt' }, { key: 'duration', role: 'duration' }, { key: 'references', role: 'references', kind: 'asset' }] } as unknown as GenAiWorkflowDefinition;
const request = {
  modelId: 'seedance', workflowId: 'higgsfield:seedance:frames2video', prompt: 'move', providerPrompt: 'move',
  fields: { duration: 5 }, references: [
    { id: 'a', purpose: 'first_frame' }, { id: 'b', purpose: 'last_frame' }
  ]
} as unknown as GenAiGenerationRequest;

describe('Higgsfield generation normalization', () => {
  it('preserves reference order and semantic frame roles', () => {
    expect(buildHiggsfieldGenerationParams(request, workflow, [
      { assetId: 'a' as never, providerAssetId: 'media-a', mediaType: 'image/png' },
      { assetId: 'b' as never, providerAssetId: 'media-b', mediaType: 'image/png' }
    ])).toMatchObject({ duration: 5, medias: [
      { role: 'start_image', value: 'media-a' }, { role: 'end_image', value: 'media-b' }
    ] });
  });

  it('accepts only one unambiguous generation id', () => {
    expect(extractHiggsfieldGenerationId({ structuredContent: { results: [{ generation_id: 'job_123456' }] } })).toBe('job_123456');
    expect(extractHiggsfieldGenerationId({ model: { id: 'seedance_2_0' }, generation_id: 'job_123456' })).toBe('job_123456');
    expect(() => extractHiggsfieldGenerationId({ ids: ['job_123456', 'job_654321'] })).toThrow(/multiple conflicting/u);
  });

  it('normalizes completion media without inventing a status endpoint', () => {
    expect(normalizeHiggsfieldCompletion({ status: 'completed', results: [{ resource_url: 'https://media.test/out.mp4' }] }))
      .toEqual({ state: 'succeeded', urls: ['https://media.test/out.mp4'] });
    expect(normalizeHiggsfieldCompletion({ status: 'running', preview_url: 'https://media.test/preview.mp4' }))
      .toEqual({ state: 'running', urls: [] });
  });
});
