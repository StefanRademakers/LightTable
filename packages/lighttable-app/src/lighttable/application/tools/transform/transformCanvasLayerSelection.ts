import type { LayerId } from '../../../editor/document/documentTypes';

export interface TransformCanvasLayerSelection {
  readonly selectedLayerIds: readonly LayerId[];
  readonly activeLayerId: LayerId;
}

/**
 * Resolves spatial Move-tool selection independently from the layer-panel's
 * ordered range-selection policy. Shift toggles one painted hit while keeping
 * at least one canonical active layer. An empty canvas hit never reaches this
 * policy, so it preserves the current selection.
 */
export const resolveTransformCanvasLayerSelection = (
  selectedLayerIds: readonly LayerId[],
  activeLayerId: LayerId | null,
  pickedLayerId: LayerId,
  extend: boolean
): TransformCanvasLayerSelection => {
  const selected = [...new Set(selectedLayerIds)];
  if (!selected.length && activeLayerId) selected.push(activeLayerId);
  if (!extend) return { selectedLayerIds: [pickedLayerId], activeLayerId: pickedLayerId };

  if (!selected.includes(pickedLayerId)) {
    return {
      selectedLayerIds: [...selected, pickedLayerId],
      activeLayerId: pickedLayerId
    };
  }
  if (selected.length === 1) {
    return { selectedLayerIds: selected, activeLayerId: pickedLayerId };
  }

  const remaining = selected.filter((layerId) => layerId !== pickedLayerId);
  return {
    selectedLayerIds: remaining,
    activeLayerId: activeLayerId && remaining.includes(activeLayerId)
      ? activeLayerId
      : remaining.at(-1)!
  };
};
