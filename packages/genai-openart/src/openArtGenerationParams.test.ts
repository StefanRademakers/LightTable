import { describe, expect, it } from 'vitest';
import type {
  GenAiAssetId,
  GenAiGenerationRequest,
  GenAiModelId,
  GenAiProviderId,
  GenAiWorkflowDefinition,
  GenAiWorkflowId
} from '@lighttable/genai-core';
import { buildOpenArtGenerationParams } from './openArtGenerationParams';

const assetId = 'asset-face' as GenAiAssetId;
const request = {
  providerId: 'openart' as GenAiProviderId,
  modelId: 'nano-banana-pro' as GenAiModelId,
  workflowId: 'openart:nano-banana-pro:image2image' as GenAiWorkflowId,
  prompt: 'Use @face',
  providerPrompt: 'Use @image1',
  promptBindings: [{ token: '@face', assetId, providerLabel: '@image1' }],
  fields: { imageCount: 1 },
  references: [{ id: assetId, projectId: 'project', label: 'face.png', mediaType: 'image/png' }]
} satisfies GenAiGenerationRequest;

const workflow = {
  id: request.workflowId,
  providerId: request.providerId,
  modelId: request.modelId,
  label: 'Image to image',
  mode: 'image2image',
  fields: [{
    key: 'visualReferences', role: 'references', label: 'Visual references', kind: 'asset', required: true,
    advanced: false, sourceSchema: { type: 'array' }
  }, {
    key: 'prompt', role: 'prompt', label: 'Prompt', kind: 'string', required: true,
    advanced: false, sourceSchema: { type: 'string' }
  }]
} satisfies GenAiWorkflowDefinition;

describe('buildOpenArtGenerationParams', () => {
  it('binds provider prompt tokens to matching reachable references', () => {
    expect(buildOpenArtGenerationParams(request, workflow, [{
      assetId, url: 'https://assets.example/face.png', mediaType: 'image/png'
    }])).toEqual({
      imageCount: 1,
      prompt: 'Use @image1',
      visualReferences: [{
        type: 'image', id: 'image1', label: 'image1', url: 'https://assets.example/face.png'
      }]
    });
  });

  it('never silently submits a local-only reference', () => {
    expect(() => buildOpenArtGenerationParams(request, workflow, []))
      .toThrow('Reference @face has no reachable provider URL.');
  });

  it('maps neutral prompt and reference roles to provider-owned field keys', () => {
    const providerWorkflow = {
      ...workflow,
      fields: workflow.fields.map((field) => field.role === 'prompt'
        ? { ...field, key: 'text' }
        : field.role === 'references'
          ? { ...field, key: 'inputImages' }
          : field)
    } satisfies GenAiWorkflowDefinition;
    expect(buildOpenArtGenerationParams(request, providerWorkflow, [{
      assetId, url: 'https://assets.example/face.png', mediaType: 'image/png'
    }])).toMatchObject({ text: 'Use @image1', inputImages: [{ url: 'https://assets.example/face.png' }] });
  });
});
