import { describe, expect, it } from 'vitest';
import type { GenAiModelId } from '@lighttable/genai-core';
import { openArtBootstrapWorkflow } from './openArtWorkflowBootstrap';

describe('OpenArt workflow bootstrap', () => {
  it('keeps Nano Banana Pro usable when live discovery is unavailable', () => {
    const workflow = openArtBootstrapWorkflow('nano-banana-pro' as GenAiModelId, 'image2image');
    expect(workflow?.fields.map(({ key, role }) => [key, role])).toEqual([
      ['prompt', 'prompt'],
      ['imageCount', 'output-count'],
      ['aspectRatio', 'aspect-ratio'],
      ['resolution', 'output-size'],
      ['visualReferences', 'references']
    ]);
  });

  it('surfaces GPT Image 2 provider keys behind shared UI roles', () => {
    const workflow = openArtBootstrapWorkflow('gpt-image-2' as GenAiModelId, 'text2image');
    expect(workflow?.fields).toMatchObject([
      { key: 'prompt', role: 'prompt' },
      { key: 'imageCount', role: 'output-count' },
      { key: 'aspectRatio', role: 'aspect-ratio' },
      { key: 'resolutionTier', role: 'output-size', defaultValue: '2k' },
      { key: 'quality', role: 'quality', defaultValue: 'medium' }
    ]);
  });
});
