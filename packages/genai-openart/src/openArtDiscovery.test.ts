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

  it('projects OpenArt video transport modes into stable LightTable variants', () => {
    expect(normalizeOpenArtModels({ models: [{
      id: 'seedance', displayName: 'Seedance',
      modes: ['text2video', 'image2video', 'element2video']
    }] })[0]?.capabilities).toEqual(['text2video', 'frames2video', 'references2video']);
    expect(normalizeOpenArtWorkflow({
      model: 'seedance', mode: 'image2video',
      schemaCore: { type: 'object', required: ['prompt', 'startFrame'], properties: {
        prompt: { type: 'string' }, startFrame: { type: 'object' }, endFrame: { type: 'object' },
        duration: { type: 'integer', minimum: 4, maximum: 15 }
      } }
    }, 'seedance', 'image2video')).toMatchObject({
      id: 'openart:seedance:frames2video', mode: 'frames2video', fields: [
        { key: 'prompt', role: 'prompt' },
        { key: 'startFrame', role: 'first-frame', kind: 'asset', required: true },
        { key: 'endFrame', role: 'last-frame', kind: 'asset' },
        { key: 'duration', role: 'duration', kind: 'integer' }
      ]
    });
  });

  it('selects and dereferences the schema branch belonging to the requested video variant', () => {
    const schemaCore = {
      type: 'object',
      properties: { prompt: { type: 'string' } },
      required: ['prompt'],
      oneOf: [
        { $ref: '#/$defs/frames' },
        { $ref: '#/$defs/references' }
      ],
      $defs: {
        frames: { type: 'object', required: ['startFrame'], properties: { startFrame: { type: 'object' } } },
        references: { type: 'object', properties: {
          creationMode: { const: 'element' }, visualReferences: { type: 'array', maxItems: 7 }
        } }
      }
    };
    const frames = normalizeOpenArtWorkflow({ model: 'video', mode: 'image2video', schemaCore }, 'video', 'image2video');
    const references = normalizeOpenArtWorkflow(
      { model: 'video', mode: 'element2video', schemaCore }, 'video', 'element2video'
    );
    expect(frames.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'startFrame', role: 'first-frame', required: true })
    ]));
    expect(frames.fields.some(({ key }) => key === 'visualReferences')).toBe(false);
    expect(references.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'creationMode', locked: true, defaultValue: 'element' }),
      expect.objectContaining({ key: 'visualReferences', role: 'references' })
    ]));
    expect(references.fields.some(({ key }) => key === 'startFrame')).toBe(false);
  });

  it('normalizes the live form instead of hardcoding Nano Banana fields', () => {
    const workflow = normalizeOpenArtWorkflow({
      model: 'nano-banana-pro', mode: 'text2image',
      jsonSchema: { type: 'object', required: ['prompt'], properties: { prompt: { type: 'string' } } }
    }, 'nano-banana-pro', 'text2image');
    expect(workflow).toMatchObject({ mode: 'text2image', fields: [
      { key: 'prompt', role: 'prompt', required: true }
    ] });
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
        { key: 'quality', role: 'quality', kind: 'enum', defaultValue: 'medium', options: [
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
      { key: 'prompt', role: 'prompt', kind: 'string', required: true },
      { key: 'imageCount', role: 'output-count', kind: 'integer', minimum: 1, maximum: 4, defaultValue: 1 },
      { key: 'aspectRatio', role: 'aspect-ratio', kind: 'enum', defaultValue: '1:1' },
      { key: 'resolution', role: 'output-size', kind: 'enum', defaultValue: '1K' },
      { key: 'autoEnhancePrompt', kind: 'boolean', defaultValue: false },
      { key: 'visualReferences', role: 'references', kind: 'asset', required: true },
      { key: 'seed', kind: 'integer' },
      { key: 'providerFutureField', kind: 'unknown', sourceSchema: {
        oneOf: [{ type: 'string' }, { type: 'number' }]
      } }
    ]);
  });

  it('prefers the normalized schemaCore contract over nested reference schemas', () => {
    const workflow = normalizeOpenArtWorkflow({
      model: 'nano-banana-pro',
      mode: 'image2image',
      schemaCore: {
        type: 'object',
        properties: {
          prompt: { type: 'string' },
          aspectRatio: { type: 'string', enum: ['1:1', '16:9'] },
          resolution: { type: 'string', enum: ['1K', '2K', '4K'] }
        },
        $defs: { image: { type: 'object', properties: { url: { type: 'string' } } } }
      },
      defaults: { aspectRatio: '1:1', resolution: '1K' }
    }, 'nano-banana-pro', 'image2image');

    expect(workflow.fields.map(({ key }) => key)).toEqual([
      'prompt', 'aspectRatio', 'resolution'
    ]);
  });

  it('reads MCP text when structured content contains no workflow schema', () => {
    const workflow = normalizeOpenArtWorkflow({
      structuredContent: { result: {} },
      content: [{ type: 'text', text: JSON.stringify({
        model: 'gpt-image-2', mode: 'text2image',
        schemaCore: { type: 'object', properties: {
          resolutionTier: { type: 'string', enum: ['1K', '2K'] }
        } }
      }) }]
    }, 'gpt-image-2', 'text2image');
    expect(workflow.fields).toMatchObject([
      { key: 'resolutionTier', role: 'output-size' }
    ]);
  });

  it('rejects empty provider forms instead of poisoning the workflow cache', () => {
    expect(() => normalizeOpenArtWorkflow({
      model: 'nano-banana-pro', mode: 'text2image',
      schemaCore: { type: 'object', properties: {} }
    }, 'nano-banana-pro', 'text2image')).toThrow('without usable fields');
  });

});
