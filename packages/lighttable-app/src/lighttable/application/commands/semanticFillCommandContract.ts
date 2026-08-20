import type { LayerId } from '../../editor/document/documentTypes';
import type { PaintChannel } from '../../editor/session/editorSession';

export interface SemanticFillCommand {
  readonly layerId: LayerId;
  readonly channel: PaintChannel;
  readonly color: string;
  readonly preserveTransparency?: boolean;
  readonly opacity?: number;
}

const record = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

export const parseSemanticFillCommand = (
  value: unknown
): SemanticFillCommand | { readonly message: string } => {
  if (!record(value) || typeof value.layerId !== 'string' || value.layerId.length < 1
    || value.layerId.length > 512 || (value.channel !== 'pixels' && value.channel !== 'mask')
    || typeof value.color !== 'string' || !/^#[0-9a-f]{6}$/iu.test(value.color)
    || (value.preserveTransparency !== undefined && typeof value.preserveTransparency !== 'boolean')
    || (value.opacity !== undefined && (typeof value.opacity !== 'number'
      || !Number.isFinite(value.opacity) || value.opacity < 0 || value.opacity > 1))) {
    return { message: 'Fill requires an explicit layer, pixels/mask channel, six-digit hex color and opacity from 0 to 1.' };
  }
  return {
    layerId: value.layerId as LayerId,
    channel: value.channel as PaintChannel,
    color: value.color.toLowerCase(),
    ...(value.preserveTransparency === undefined ? {} : { preserveTransparency: value.preserveTransparency }),
    ...(value.opacity === undefined ? {} : { opacity: value.opacity })
  };
};
