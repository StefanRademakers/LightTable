import type { LayerId } from '../../editor/document/documentTypes';

export interface SemanticRasterInvertCommand {
  readonly layerId: LayerId;
  readonly channel: 'pixels' | 'mask';
}

export const parseSemanticRasterInvertCommand = (
  value: unknown
): SemanticRasterInvertCommand | { readonly message: string } => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { message: 'Raster invert parameters must be an object.' };
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => key !== 'layerId' && key !== 'channel')
    || typeof input.layerId !== 'string'
    || (input.channel !== 'pixels' && input.channel !== 'mask')) {
    return { message: 'Raster invert requires exactly layerId and pixels or mask channel.' };
  }
  return { layerId: input.layerId as LayerId, channel: input.channel };
};
