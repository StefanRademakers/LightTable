import type { LayerId } from '../../../editor/document/documentTypes';

/**
 * Resolves the canonical layer targets for a transform launch.
 *
 * Layer-panel selection is React presentation state and can trail a canonical
 * active-layer mutation by one render/effect. A transform must never launch
 * against that stale selection: the canonical active layer is the target
 * authority, while a multi-selection is valid only when it contains it.
 */
export const resolveTransformTargetLayerIds = (
  activeLayerId: LayerId | null,
  selectedLayerIds: readonly LayerId[]
): readonly LayerId[] => {
  const selected = [...new Set(selectedLayerIds)];
  if (!activeLayerId) return [];
  return selected.includes(activeLayerId) ? selected : [activeLayerId];
};
