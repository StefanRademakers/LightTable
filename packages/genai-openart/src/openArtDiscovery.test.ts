import { describe, expect, it } from 'vitest';
import { mcpToolPayload, normalizeOpenArtCost, normalizeOpenArtModels, normalizeOpenArtWorkflow } from './openArtDiscovery';
import { capturedNanoBananaImageEditForm } from './fixtures/openArtCapturedFixtures';

describe('OpenArt discovery normalization', () => {
  it('reads structured MCP model results and preserves live modes', () => {
    const payload = mcpToolPayload({ structuredContent: { result: { models: [{
      id: 'nano-banana-pro', displayName: 'Nano Banana Pro', modes: ['text2image', 'image2image']
    }] } } });
    expect(normalizeOpenArtModels(payload)[0]).toMatchObject({
      id: 'nano-banana-pro', label: 'Nano Banana Pro', capabilities: ['text2image', 'image2image']
    });
  });

  it('normalizes the live form instead of hardcoding Nano Banana fields', () => {
    const workflow = normalizeOpenArtWorkflow({
      model: 'nano-banana-pro', mode: 'text2image',
      jsonSchema: { type: 'object', required: ['prompt'], properties: { prompt: { type: 'string' } } }
    }, 'nano-banana-pro', 'text2image');
    expect(workflow).toMatchObject({ mode: 'text2image', fields: [{ key: 'prompt', required: true }] });
  });

  it('preserves GPT Image 2 quality as a reusable enum field', () => {
    const workflow = normalizeOpenArtWorkflow({
      model: 'gpt-image-2', mode: 'text2image', defaults: { quality: 'medium' },
      jsonSchema: { type: 'object', required: ['prompt'], properties: {
        prompt: { type: 'string' },
        quality: { type: 'string', title: 'Quality', enum: ['low', 'medium', 'high', 'auto'] }
      } }
    }, 'gpt-image-2', 'text2image');
    expect(workflow).toMatchObject({
      modelId: 'gpt-image-2',
      fields: [
        { key: 'prompt', kind: 'string' },
        { key: 'quality', kind: 'enum', defaultValue: 'medium', options: [
          { value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'auto' }
        ] }
      ]
    });
  });

  it('normalizes nested provider credit estimates without exposing the envelope', () => {
    expect(normalizeOpenArtCost({ result: { estimate: { totalCredits: 12.5 } } })).toEqual({
      amount: 12.5, unit: 'credits', label: '12.5 credits'
    });
    expect(normalizeOpenArtCost({ result: { available: false } })).toBeNull();
  });

  it('normalizes the captured image-edit fixture without losing future provider fields', () => {
    const workflow = normalizeOpenArtWorkflow(
      capturedNanoBananaImageEditForm,
      'nano-banana-2',
      'image2image'
    );
    expect(workflow.fields).toMatchObject([
      { key: 'prompt', kind: 'string', required: true },
      { key: 'imageCount', kind: 'integer', minimum: 1, maximum: 4, defaultValue: 1 },
      { key: 'aspectRatio', kind: 'enum', defaultValue: '1:1' },
      { key: 'resolution', kind: 'enum', defaultValue: '1K' },
      { key: 'autoEnhancePrompt', kind: 'boolean', defaultValue: false },
      { key: 'visualReferences', kind: 'asset', required: true },
      { key: 'seed', kind: 'integer' },
      { key: 'providerFutureField', kind: 'unknown', sourceSchema: {
        oneOf: [{ type: 'string' }, { type: 'number' }]
      } }
    ]);
  });
});
