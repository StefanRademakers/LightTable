/**
 * Stable, provider-shaped fixture distilled from the checked-in OpenArt MCP
 * export. It intentionally remains provider data rather than a UI model.
 */
export const capturedNanoBananaImageEditForm = {
  model: 'nano-banana-2',
  mode: 'image2image',
  schemaCore: {
    type: 'object',
    properties: {
      prompt: { type: 'string', minLength: 1 },
      imageCount: { default: 2, type: 'integer', minimum: 1, maximum: 4 },
      aspectRatio: { type: 'string', enum: ['16:9', '1:1', '9:16'] },
      resolution: { default: '1K', type: 'string', enum: ['1K', '2K', '4K'] },
      autoEnhancePrompt: { default: false, type: 'boolean' },
      visualReferences: {
        default: [], maxItems: 14, type: 'array', items: { $ref: '#/$defs/imageReference' }
      },
      seed: { type: ['integer', 'null'], minimum: 0 },
      providerFutureField: { oneOf: [{ type: 'string' }, { type: 'number' }] }
    },
    required: ['prompt', 'imageCount', 'aspectRatio', 'resolution', 'visualReferences'],
    additionalProperties: false
  },
  defaults: {
    imageCount: 1,
    aspectRatio: '1:1',
    resolution: '1K',
    autoEnhancePrompt: false
  }
} as const;
