import type {
  AttachedAdjustment,
  LayerId,
  RasterLayer
} from '../editor/document/documentTypes';

export const attachedAdjustmentOwnerId = (
  layerId: LayerId,
  adjustmentId: string
): LayerId => `${layerId}::attached-adjustment::${adjustmentId}` as LayerId;

export const parseAttachedAdjustmentOwnerId = (ownerId: LayerId): {
  layerId: LayerId;
  adjustmentId: string;
} | null => {
  const marker = '::attached-adjustment::';
  const index = ownerId.indexOf(marker);
  if (index < 1) return null;
  const adjustmentId = ownerId.slice(index + marker.length);
  return adjustmentId
    ? { layerId: ownerId.slice(0, index) as LayerId, adjustmentId }
    : null;
};

/**
 * Presents an attached node to the existing per-layer GPU pipeline without
 * duplicating any renderer or effect implementation.
 */
export const attachedAdjustmentProcessingOwner = (
  layer: RasterLayer,
  adjustment: AttachedAdjustment
): RasterLayer => ({
  ...layer,
  id: attachedAdjustmentOwnerId(layer.id, adjustment.id),
  name: adjustment.name,
  adjustmentStack: adjustment.adjustmentStack,
  attachedAdjustments: []
});
