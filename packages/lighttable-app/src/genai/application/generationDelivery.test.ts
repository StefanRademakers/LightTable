import { describe, expect, it } from 'vitest';
import type { GenAiGenerationJob } from '@lighttable/genai-core';
import { GenAiEditorDeliveryTracker, isImageEditGeneration } from './generationDelivery';

const succeededJob = (id: string): GenAiGenerationJob => ({
  id: id as GenAiGenerationJob['id'],
  request: {
    providerId: 'openart' as GenAiGenerationJob['request']['providerId'],
    modelId: 'model' as GenAiGenerationJob['request']['modelId'],
    workflowId: 'workflow' as GenAiGenerationJob['request']['workflowId'],
    prompt: 'Prompt', providerPrompt: 'Prompt', promptBindings: [], fields: {}, references: []
  },
  status: 'succeeded', createdAt: 1, updatedAt: 2,
  results: [{ assetId: 'asset' as GenAiGenerationJob['results'][number]['assetId'], mediaType: 'image/png' }]
});

const withWorkflow = (workflowId: string) => ({
  ...succeededJob(workflowId),
  request: {
    ...succeededJob(workflowId).request,
    workflowId: workflowId as GenAiGenerationJob['request']['workflowId']
  }
});

describe('GenAiEditorDeliveryTracker', () => {
  it('claims a newly completed result only once', () => {
    const tracker = new GenAiEditorDeliveryTracker();
    tracker.selectProject('one');
    expect(tracker.claim(succeededJob('job'))).toBe(true);
    expect(tracker.claim(succeededJob('job'))).toBe(false);
  });

  it('treats journal results as history and resets between projects', () => {
    const tracker = new GenAiEditorDeliveryTracker();
    tracker.selectProject('one');
    tracker.rememberExisting([succeededJob('job')]);
    expect(tracker.claim(succeededJob('job'))).toBe(false);
    tracker.selectProject('two');
    expect(tracker.claim(succeededJob('job'))).toBe(true);
  });

  it('classifies edit workflows without depending on OpenArt vocabulary', () => {
    expect(isImageEditGeneration(withWorkflow('openart:model:image2image'))).toBe(true);
    expect(isImageEditGeneration(withWorkflow('lighttable-local:model:image.edit'))).toBe(true);
    expect(isImageEditGeneration(withWorkflow('lighttable-local:model:image.create'))).toBe(false);
  });
});
