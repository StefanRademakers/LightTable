import type { GenAiFieldDefinition } from './contracts';

export type GenAiFieldPlacement = 'featured' | 'basic' | 'advanced';

/**
 * LightTable-owned presentation only. Provider schemas remain untouched and
 * authoritative for validation; these hints merely reduce normal-panel noise.
 */
const featuredRoles = new Set(['aspect-ratio', 'output-size', 'quality', 'output-count']);
const advancedFields = new Set([
  'autoEnhancePrompt', 'seed', 'negativePrompt', 'guidanceScale', 'steps', 'sampler', 'scheduler'
]);
const advancedRoles = new Set(['negative-prompt', 'seed', 'width', 'height']);

export const genAiFieldPlacement = (field: GenAiFieldDefinition): GenAiFieldPlacement => (
  field.role && featuredRoles.has(field.role)
    ? 'featured'
    : field.advanced || field.kind === 'unknown' || advancedFields.has(field.key)
      || Boolean(field.role && advancedRoles.has(field.role))
      ? 'advanced'
      : 'basic'
);
