import type { GenAiFieldDefinition, GenAiWorkflowDefinition } from '@lighttable/genai-core';

export interface GenAiDocumentContext {
  readonly id: string;
  readonly width: number;
  readonly height: number;
}

const validDimension = (value: number): boolean => Number.isFinite(value) && value > 0;

export const genAiDocumentContextKey = (
  context: GenAiDocumentContext | undefined
): string | undefined => context && validDimension(context.width) && validDimension(context.height)
  ? `${context.id}:${context.width}x${context.height}`
  : undefined;

const parseAspectRatio = (value: string): number | undefined => {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*[:/x]\s*(\d+(?:\.\d+)?)$/iu);
  if (!match) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return validDimension(width) && validDimension(height) ? width / height : undefined;
};

const optionPixels = (value: string): number | undefined => {
  const normalized = value.trim();
  const tier = normalized.match(/^(\d+(?:\.\d+)?)\s*k$/iu);
  if (tier) return Number(tier[1]) * 1024;
  const dimensions = normalized.match(/^(\d+)\s*[x×]\s*(\d+)$/iu);
  if (dimensions) return Math.max(Number(dimensions[1]), Number(dimensions[2]));
  const pixels = normalized.match(/^(\d+)\s*(?:px)?$/iu);
  return pixels ? Number(pixels[1]) : undefined;
};

const closestAspectOption = (
  field: GenAiFieldDefinition,
  context: GenAiDocumentContext
): string | undefined => {
  const target = context.width / context.height;
  return field.options
    ?.map((option) => ({ option, ratio: parseAspectRatio(option.value) ?? parseAspectRatio(option.label) }))
    .filter((entry): entry is typeof entry & { ratio: number } => entry.ratio !== undefined)
    .sort((left, right) => Math.abs(Math.log(left.ratio / target)) - Math.abs(Math.log(right.ratio / target)))[0]
    ?.option.value;
};

const coveringSizeOption = (
  field: GenAiFieldDefinition,
  context: GenAiDocumentContext
): string | undefined => {
  const options = field.options
    ?.map((option) => ({ option, pixels: optionPixels(option.value) ?? optionPixels(option.label) }))
    .filter((entry): entry is typeof entry & { pixels: number } => entry.pixels !== undefined)
    .sort((left, right) => left.pixels - right.pixels);
  if (!options?.length) return undefined;
  const twoK = options.find(({ pixels }) => pixels === 2 * 1024);
  // 1K costs the same as 2K for the supported GenAI providers. Keep 1K as an
  // explicit user choice, but never select it as an automatic document default.
  const target = Math.max(context.width, context.height, twoK?.pixels ?? 0);
  return (options.find(({ pixels }) => pixels >= target) ?? options.at(-1))?.option.value;
};

/**
 * Applies the provider-independent minimum output default used by LightTable.
 * Provider schemas may advertise 1K as their own default; the UI deliberately
 * starts at 2K when that tier exists because it has the same generation cost.
 */
export const applyGenAiOutputSizeDefault = (
  workflow: GenAiWorkflowDefinition,
  current: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> => {
  let next = current;
  for (const field of workflow.fields) {
    if (field.role !== 'output-size') continue;
    const preferred = field.options?.find((option) =>
      (optionPixels(option.value) ?? optionPixels(option.label)) === 2 * 1024
    )?.value;
    if (preferred !== undefined && next[field.key] !== preferred) {
      next = { ...next, [field.key]: preferred };
    }
  }
  return next;
};

/**
 * Applies only provider-supported values. The provider adapter remains the
 * owner of field keys; the application understands document intent by role.
 */
export const matchGenAiValuesToDocument = (
  workflow: GenAiWorkflowDefinition,
  current: Readonly<Record<string, unknown>>,
  context: GenAiDocumentContext
): Readonly<Record<string, unknown>> => {
  if (!genAiDocumentContextKey(context) || workflow.mode !== 'image2image') return current;
  let next = current;
  for (const field of workflow.fields) {
    const value = field.role === 'aspect-ratio'
      ? closestAspectOption(field, context)
      : field.role === 'output-size'
        ? coveringSizeOption(field, context)
        : undefined;
    if (value !== undefined && next[field.key] !== value) next = { ...next, [field.key]: value };
  }
  return next;
};

/**
 * Applies LightTable's product defaults to a newly opened image-create form.
 * The UI owns these semantic choices. Provider adapters translate them to
 * provider-specific parameters; provider schemas do not redefine the UX.
 */
export const applyGenAiImageCreateDefaults = (
  workflow: GenAiWorkflowDefinition,
  current: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> => {
  if (workflow.mode !== 'text2image') return current;
  let next = current;
  for (const field of workflow.fields) {
    const preferredValue = field.role === 'aspect-ratio'
      ? '16:9'
      : field.role === 'output-size'
        ? '2K'
        : undefined;
    if (!preferredValue) continue;
    if (next[field.key] !== preferredValue) next = { ...next, [field.key]: preferredValue };
  }
  return next;
};
