import type { GradientPaintInstance } from '@lighttable/paint-core';
import { BLEND_MODES, type BlendMode } from '../../editor/document/blendModes';
import type { LayerId } from '../../editor/document/documentTypes';
import type { PaintChannel } from '../../editor/session/editorSession';
import { parseGradientPaintCommand } from './gradientPaintCommandContract';

export interface SemanticRasterGradientCommand {
  readonly layerId: LayerId;
  readonly channel: PaintChannel;
  readonly paint: GradientPaintInstance;
  readonly opacity: number;
  readonly blendMode: BlendMode;
}

const record = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

export const parseSemanticRasterGradientCommand = (
  value: unknown
): SemanticRasterGradientCommand | { readonly message: string } => {
  if (!record(value) || typeof value.layerId !== 'string' || value.layerId.length < 1
    || value.layerId.length > 512 || (value.channel !== 'pixels' && value.channel !== 'mask')
    || typeof value.opacity !== 'number' || !Number.isFinite(value.opacity)
    || value.opacity < 0 || value.opacity > 1
    || !BLEND_MODES.some(({ id }) => id === value.blendMode)) {
    return { message: 'Raster gradient requires an explicit layer/channel, opacity from 0 to 1 and supported blend mode.' };
  }
  const paint = parseGradientPaintCommand(value.paint, ['layer', 'document']);
  if ('message' in paint) return paint;
  return { layerId: value.layerId as LayerId, channel: value.channel as PaintChannel,
    paint, opacity: value.opacity, blendMode: value.blendMode as BlendMode };
};
