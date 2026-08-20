import type { LayerId } from '../../editor/document/documentTypes';

export interface SemanticTextFinalizationCommand {
  readonly layerId: LayerId;
}

export const parseSemanticTextFinalizationCommand = (
  value: unknown,
  label: string
): SemanticTextFinalizationCommand | { readonly message: string } => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { message: `${label} parameters must be an object.` };
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 1 || typeof input.layerId !== 'string'
    || input.layerId.length === 0) {
    return { message: `${label} requires exactly one non-empty layerId.` };
  }
  return { layerId: input.layerId as LayerId };
};
