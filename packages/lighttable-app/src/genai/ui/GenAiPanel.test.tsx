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

  it('keeps the current form visible during a background workflow refresh', () => {
    const markup = renderToStaticMarkup(<GenAiPanel providerName="OpenArt" status="connected"
      projectName="Project" models={[model]} workflow={workflow('text2image')} selectedModelId={modelId}
      selectedMode="text2image" loading values={{ prompt: 'Keep this prompt visible' }} />);
    expect(markup).toContain('class="genai-panel__form"');
    expect(markup).toContain('class="genai-prompt-composer"');
    expect(markup).not.toContain('Loading image model');
  });

  it('keeps Nano Banana aspect ratio and resolution in the fixed bottom settings row', () => {
    const nanoWorkflow: GenAiWorkflowDefinition = {
      ...workflow('text2image'),
      fields: [
        ...workflow('text2image').fields,
        { key: 'aspectRatio', label: 'Aspect ratio', kind: 'enum', required: true, advanced: false,
          defaultValue: '1:1', options: [{ label: '1:1', value: '1:1' }], sourceSchema: { type: 'string' } },
        { key: 'resolution', label: 'Resolution', kind: 'enum', required: true, advanced: false,
          defaultValue: '1K', options: [{ label: '1K', value: '1K' }], sourceSchema: { type: 'string' } }
      ]
    };
    const markup = renderToStaticMarkup(<GenAiPanel providerName="OpenArt" status="connected"
      projectName="Project" models={[model]} workflow={nanoWorkflow} selectedModelId={modelId}
      selectedMode="text2image" values={{ prompt: 'Test', aspectRatio: '1:1', resolution: '1K' }} />);
    expect(markup).toContain('aria-label="Aspect ratio"');
    expect(markup).toContain('aria-label="Resolution"');
    expect(markup.indexOf('genai-panel__featured-settings')).toBeGreaterThan(markup.indexOf('genai-panel__body'));
    expect(markup.indexOf('genai-panel__footer')).toBeGreaterThan(markup.indexOf('genai-panel__featured-settings'));
  });

  it('keeps GPT Image 2 quality in the fixed bottom settings row', () => {
    const gptModel = { ...model, id: 'gpt-image-2' as GenAiModelId, label: 'GPT Image 2' };
    const gptWorkflow: GenAiWorkflowDefinition = {
      ...workflow('text2image'), id: 'openart:gpt-image-2:text2image' as GenAiWorkflowId,
      modelId: gptModel.id,
      fields: [
        ...workflow('text2image').fields,
        { key: 'quality', label: 'Quality', kind: 'enum', required: false, advanced: false,
          defaultValue: 'high', options: [{ label: 'High', value: 'high' }], sourceSchema: { type: 'string' } }
      ]
    };
    const markup = renderToStaticMarkup(<GenAiPanel providerName="OpenArt" status="connected"
      projectName="Project" models={[gptModel]} workflow={gptWorkflow} selectedModelId={gptModel.id}
      selectedMode="text2image" values={{ prompt: 'Test', quality: 'high' }} />);
    expect(markup).toContain('genai-panel__featured-setting');
    expect(markup).toContain('High');
  });
});
