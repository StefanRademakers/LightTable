import type { LayerId } from '../../editor/document/documentTypes';

export type BackgroundRemovalMaskMode = 'replace' | 'intersect' | 'new-layer';

export interface SemanticBackgroundRemovalCommand {
  readonly layerId: LayerId;
  readonly mode: BackgroundRemovalMaskMode;
}

export const parseSemanticBackgroundRemovalCommand = (
  value: unknown
): SemanticBackgroundRemovalCommand | { readonly message: string } => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { message: 'Remove Background parameters must be an object.' };
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => key !== 'layerId' && key !== 'mode')
    || typeof input.layerId !== 'string' || !input.layerId
    || (input.mode !== 'replace' && input.mode !== 'intersect' && input.mode !== 'new-layer')) {
    return { message: 'Remove Background requires exactly layerId and replace, intersect or new-layer mode.' };
  }
  return { layerId: input.layerId as LayerId, mode: input.mode };
};
