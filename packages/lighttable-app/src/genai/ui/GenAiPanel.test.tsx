import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type {
  GenAiAssetId, GenAiAssetReference, GenAiModelId, GenAiModelSummary,
  GenAiProviderId, GenAiWorkflowDefinition, GenAiWorkflowId
} from '@lighttable/genai-core';
import { createGenAiAssetMentionOptions } from '@lighttable/genai-core';
import { GenAiPanel, isReferencePublicationError } from './GenAiPanel';

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
    { key: 'prompt', role: 'prompt', label: 'Prompt', kind: 'string', required: true, advanced: false, sourceSchema: { type: 'string' } },
    { key: 'visualReferences', label: 'Visual references', kind: 'asset', required: false,
      role: 'references', advanced: false, sourceSchema: { type: 'array', maxItems: 10 } }
  ]
});

describe('GenAiPanel visual references', () => {
  it('recognizes secure reference publication failures', () => {
    expect(isReferencePublicationError(
      'Could not publish the local reference "character.png". Reference publishing is not connected.'
    )).toBe(true);
    expect(isReferencePublicationError('OpenArt rejected the prompt.')).toBe(false);
  });

  it('keeps the panel usable when no AI provider is connected', () => {
    const markup = renderToStaticMarkup(<GenAiPanel providerName="OpenArt" status="disconnected"
      onConnect={() => undefined} />);
    expect(markup).toContain('Not connected');
    expect(markup).toContain('Connect');
    expect(markup).not.toContain('genai-panel__form');
  });

  for (const mode of ['text2image', 'image2image']) {
    it(`keeps the shared @asset reference UI available in ${mode}`, () => {
      const markup = renderToStaticMarkup(<GenAiPanel providerName="OpenArt" status="connected"
        projectName="Project" models={[model]} workflow={workflow(mode)} selectedModelId={modelId}
        selectedMode={mode} values={{ prompt: 'Use @Portrait', visualReferences: [asset] }}
        mentionOptions={createGenAiAssetMentionOptions([asset])} />);
      expect(markup).toContain('aria-label="Visual references"');
      expect(markup).not.toContain('Add project image');
      expect(markup).toContain('@Portrait');
      expect(markup).toContain('Add base image');
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

  it('explains every supported way to add an empty visual reference', () => {
    const markup = renderToStaticMarkup(<GenAiPanel providerName="OpenArt" status="connected"
      projectName="Project" models={[model]} workflow={workflow('text2image')} selectedModelId={modelId}
      selectedMode="text2image" values={{ prompt: '', visualReferences: [] }} />);
    expect(markup).toContain('Drag open tabs or assets here, or paste images.');
  });

  it('does not spend composer space on unavailable provider choices', () => {
    const markup = renderToStaticMarkup(<GenAiPanel providerName="OpenArt" status="connected"
      projectName="Project" models={[model]} workflow={workflow('text2image')} selectedModelId={modelId}
      selectedMode="text2image" values={{ prompt: 'Test' }} />);
    expect(markup).not.toContain('ComfyUI');
    expect(markup).not.toContain('Higgsfield');
    expect(markup).not.toContain('genai-panel__provider-row');
  });

  it('offers a remove action for referenced assets', () => {
    const markup = renderToStaticMarkup(<GenAiPanel providerName="OpenArt" status="connected"
      projectName="Project" models={[model]} workflow={workflow('image2image')} selectedModelId={modelId}
      selectedMode="image2image" values={{ prompt: 'Use @Portrait as reference', visualReferences: [asset] }}
      assetPreviews={{ [asset.id]: 'data:image/png;base64,preview' }}
      mentionOptions={createGenAiAssetMentionOptions([asset])} />);
    expect(markup).toContain('aria-label="Remove @Portrait"');
  });

  it('keeps a visual reference visible when its token is absent from the prompt', () => {
    const markup = renderToStaticMarkup(<GenAiPanel providerName="OpenArt" status="connected"
      projectName="Project" models={[model]} workflow={workflow('image2image')} selectedModelId={modelId}
      selectedMode="image2image" values={{ prompt: 'Retouch this portrait', visualReferences: [asset] }}
      assetPreviews={{ [asset.id]: 'data:image/png;base64,preview' }}
      mentionOptions={createGenAiAssetMentionOptions([asset])} />);
    expect(markup).toContain('aria-label="Remove @Portrait"');
    expect(markup).toContain('1/10');
  });

  it('renders the base-image checkbox after the visual-reference well', () => {
    const markup = renderToStaticMarkup(<GenAiPanel providerName="OpenArt" status="connected"
      projectName="Project" models={[model]} workflow={workflow('image2image')} selectedModelId={modelId}
      selectedMode="image2image" baseImageSelected values={{ prompt: 'Retouch', visualReferences: [asset] }}
      mentionOptions={createGenAiAssetMentionOptions([asset])} />);
    expect(markup).toContain('type="checkbox" checked=""');
    expect(markup.indexOf('genai-panel__base-image')).toBeGreaterThan(markup.indexOf('genai-panel__reference-well'));
  });

  it('also exposes the optional base image in Image Create', () => {
    const markup = renderToStaticMarkup(<GenAiPanel providerName="OpenArt" status="connected"
      projectName="Project" models={[model]} workflow={workflow('text2image')} selectedModelId={modelId}
      selectedMode="text2image" baseImageSelected={false} values={{ prompt: 'Create', visualReferences: [asset] }}
      mentionOptions={createGenAiAssetMentionOptions([asset])} />);
    expect(markup).toContain('Add base image');
    expect(markup).not.toContain('type="checkbox" checked=""');
  });

  it('keeps Nano Banana aspect ratio and resolution in the fixed bottom settings row', () => {
    const nanoWorkflow: GenAiWorkflowDefinition = {
      ...workflow('text2image'),
      fields: [
        ...workflow('text2image').fields,
        { key: 'providerAspect', role: 'aspect-ratio', label: 'Aspect ratio', kind: 'enum', required: true, advanced: false,
          defaultValue: '1:1', options: [{ label: '1:1', value: '1:1' }], sourceSchema: { type: 'string' } },
        { key: 'providerResolution', role: 'output-size', label: 'Resolution', kind: 'enum', required: true, advanced: false,
          defaultValue: '1K', options: [{ label: '1K', value: '1K' }], sourceSchema: { type: 'string' } }
      ]
    };
    const markup = renderToStaticMarkup(<GenAiPanel providerName="OpenArt" status="connected"
      projectName="Project" models={[model]} workflow={nanoWorkflow} selectedModelId={modelId}
      selectedMode="text2image" values={{ prompt: 'Test', providerAspect: '1:1', providerResolution: '1K' }} />);
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
        { key: 'quality', role: 'quality', label: 'Quality', kind: 'enum', required: false, advanced: false,
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
