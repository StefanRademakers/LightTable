import { describe, expect, it } from 'vitest';
import { normalizeGenAiJsonSchema } from './schemaNormalizer';

describe('normalizeGenAiJsonSchema', () => {
  it('projects provider fields without inventing validation rules', () => {
    const fields = normalizeGenAiJsonSchema({
      type: 'object', required: ['prompt'], properties: {
        prompt: { type: 'string', title: 'Prompt' },
        imageCount: { type: 'integer', minimum: 1, maximum: 4, default: 1 },
        resolution: { type: 'string', enum: ['1K', '2K', '4K'] },
        visualReferences: { type: 'array', items: { $ref: '#/$defs/reference' } }
      }
    });
    expect(fields).toMatchObject([
      { key: 'prompt', kind: 'string', required: true },
      { key: 'imageCount', kind: 'integer', minimum: 1, maximum: 4, defaultValue: 1 },
      { key: 'resolution', kind: 'enum', options: [{ value: '1K' }, { value: '2K' }, { value: '4K' }] },
      { key: 'visualReferences', kind: 'asset' }
    ]);
  });

  it('recognizes nullable scalar fields and keeps provider constructs losslessly for diagnostics', () => {
    const [nullable, unknown] = normalizeGenAiJsonSchema({ type: 'object', properties: {
      seed: { type: ['integer', 'null'], title: 'Seed', providerExtension: { mode: 'random' } },
      future: { oneOf: [{ type: 'string' }, { type: 'number' }], 'x-provider': true }
    } });
    expect(nullable).toMatchObject({ key: 'seed', kind: 'integer', sourceSchema: {
      type: ['integer', 'null'], providerExtension: { mode: 'random' }
    } });
    expect(unknown).toMatchObject({ key: 'future', kind: 'unknown', sourceSchema: {
      oneOf: [{ type: 'string' }, { type: 'number' }], 'x-provider': true
    } });
  });
});
