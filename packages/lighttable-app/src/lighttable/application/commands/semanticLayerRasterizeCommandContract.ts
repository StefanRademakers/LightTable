import type { LayerId } from '../../editor/document/documentTypes';

export interface SemanticLayerRasterizeCommand {
  readonly layerId: LayerId;
}

export const parseSemanticLayerRasterizeCommand = (
  value: unknown
): SemanticLayerRasterizeCommand | { readonly message: string } => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { message: 'Layer rasterize parameters must be an object.' };
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 1 || typeof input.layerId !== 'string'
    || input.layerId.length === 0) {
    return { message: 'Layer rasterize requires exactly one non-empty layerId.' };
  }
  return { layerId: input.layerId as LayerId };
};
