import type { GenAiFieldDefinition } from './contracts';

export type GenAiFieldPlacement = 'featured' | 'basic' | 'advanced';

/**
 * LightTable-owned presentation only. Provider schemas remain untouched and
 * authoritative for validation; these hints merely reduce normal-panel noise.
 */
const featuredFields = new Set(['aspectRatio', 'resolution', 'quality', 'imageCount']);
const advancedFields = new Set([
  'autoEnhancePrompt', 'seed', 'negativePrompt', 'guidanceScale', 'steps', 'sampler', 'scheduler'
]);

export const genAiFieldPlacement = (field: GenAiFieldDefinition): GenAiFieldPlacement => (
  featuredFields.has(field.key)
    ? 'featured'
    : field.advanced || field.kind === 'unknown' || advancedFields.has(field.key)
      ? 'advanced'
      : 'basic'
);
