import type { LayerId } from '../../editor/document/documentTypes';

export interface SemanticLayerMergeCommand { readonly layerIds: readonly LayerId[] }
export interface SemanticFlattenGroupCommand { readonly groupId: LayerId }

const record = (value: unknown): Record<string, unknown> | null => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null
);

export const parseSemanticLayerMergeCommand = (
  value: unknown
): SemanticLayerMergeCommand | { readonly message: string } => {
  const input = record(value);
  if (!input || Object.keys(input).length !== 1 || !Array.isArray(input.layerIds)
    || input.layerIds.length < 2 || input.layerIds.length > 256
    || input.layerIds.some((id) => typeof id !== 'string' || id.length === 0)
    || new Set(input.layerIds).size !== input.layerIds.length) {
    return { message: 'Layer merge requires exactly 2..256 unique non-empty layerIds.' };
  }
  return { layerIds: input.layerIds as LayerId[] };
};

export const parseSemanticFlattenGroupCommand = (
  value: unknown
): SemanticFlattenGroupCommand | { readonly message: string } => {
  const input = record(value);
  if (!input || Object.keys(input).length !== 1
    || typeof input.groupId !== 'string' || input.groupId.length === 0) {
    return { message: 'Flatten Group requires exactly one non-empty groupId.' };
  }
  return { groupId: input.groupId as LayerId };
};

export const parseSemanticFlattenImageCommand = (
  value: unknown
): Record<string, never> | { readonly message: string } => {
  const input = record(value);
  return input && Object.keys(input).length === 0
    ? {}
    : { message: 'Flatten Image parameters must be an empty object.' };
};
