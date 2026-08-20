export const FIXED_TRANSFORM_OPERATIONS = [
  'rotate-180',
  'rotate-clockwise-90',
  'rotate-counter-clockwise-90',
  'flip-horizontal',
  'flip-vertical'
] as const;

export type SemanticFixedTransformOperation = typeof FIXED_TRANSFORM_OPERATIONS[number];

export interface SemanticFixedTransformCommand {
  readonly operation: SemanticFixedTransformOperation;
}

const operationSet = new Set<string>(FIXED_TRANSFORM_OPERATIONS);

export const parseSemanticFixedTransformCommand = (
  value: unknown
): SemanticFixedTransformCommand | { readonly message: string } => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { message: 'Fixed transform parameters must be an object.' };
  }
  const entries = Object.entries(value);
  if (entries.length !== 1 || entries[0]?.[0] !== 'operation'
    || typeof entries[0][1] !== 'string' || !operationSet.has(entries[0][1])) {
    return { message: 'Fixed transform requires exactly one supported operation.' };
  }
  return { operation: entries[0][1] as SemanticFixedTransformOperation };
};
