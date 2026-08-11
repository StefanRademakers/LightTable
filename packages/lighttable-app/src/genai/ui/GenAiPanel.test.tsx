import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type {
  GenAiAssetId, GenAiAssetReference, GenAiModelId, GenAiModelSummary,
  GenAiProviderId, GenAiWorkflowDefinition, GenAiWorkflowId
} from '@lighttable/genai-core';
import { createGenAiAssetMentionOptions } from '@lighttable/genai-core';
import { GenAiPanel } from './GenAiPanel';

const providerId = 'openart' as GenAiProviderId;
const modelId = 'nano-banana-pro' as GenAiModelId;
const model: GenAiModelSummary = {
  id: modelId, providerId, label: 'Nano Banana Pro', capabilities: ['text2image', 'image2image']
};
const asset: GenAiAssetReference = {
  id: 'asset-portrait' as GenAiAssetId, projectId: 'project-a', label: 'Portrait.png', mediaType: 'image/png'
};

const workflow = (mode: string): GenAiWorkflowDefinition => ({
  id: `openart:${modelId}:${mode}` as GenAiWorkflowId,
  providerId, modelId, mode, label: mode,
  fields: [
    { key: 'prompt', label: 'Prompt', kind: 'string', required: true, advanced: false, sourceSchema: { type: 'string' } },
    { key: 'visualReferences', label: 'Visual references', kind: 'asset', required: false,
      advanced: false, sourceSchema: { type: 'array', maxItems: 10 } }
  ]
});

describe('GenAiPanel visual references', () => {
  for (const mode of ['text2image', 'image2image']) {
    it(`keeps the shared @asset reference UI available in ${mode}`, () => {
      const markup = renderToStaticMarkup(<GenAiPanel providerName="OpenArt" status="connected"
        projectName="Project" models={[model]} workflow={workflow(mode)} selectedModelId={modelId}
        selectedMode={mode} values={{ prompt: 'Use @Portrait' }}
        mentionOptions={createGenAiAssetMentionOptions([asset])} />);
      expect(markup).toContain('aria-label="Visual references"');
      expect(markup).toContain('Add project image');
      expect(markup).toContain('@Portrait');
    });
  }
});
