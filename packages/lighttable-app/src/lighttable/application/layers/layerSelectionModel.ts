import type { LayerId } from '../../editor/document/documentTypes';

export interface LayerSelectionState {
  readonly selectedLayerIds: readonly LayerId[];
  readonly anchorLayerId: LayerId | null;
  readonly activeLayerId: LayerId | null;
}

export interface LayerSelectionGesture {
  readonly targetLayerId: LayerId;
  readonly extend: boolean;
  readonly toggle: boolean;
}

export const resolveLayerSelectionGesture = (
  visualLayerIds: readonly LayerId[],
  state: LayerSelectionState,
  gesture: LayerSelectionGesture
): LayerSelectionState => {
  const { targetLayerId } = gesture;
  if (gesture.extend) {
    const anchor = state.anchorLayerId && visualLayerIds.includes(state.anchorLayerId)
      ? state.anchorLayerId
      : state.activeLayerId && visualLayerIds.includes(state.activeLayerId)
        ? state.activeLayerId
        : targetLayerId;
    const anchorIndex = visualLayerIds.indexOf(anchor);
    const targetIndex = visualLayerIds.indexOf(targetLayerId);
    if (anchorIndex < 0 || targetIndex < 0) {
      return { selectedLayerIds: [targetLayerId], anchorLayerId: targetLayerId,
        activeLayerId: targetLayerId };
    }
    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);
    return {
      selectedLayerIds: visualLayerIds.slice(start, end + 1),
      anchorLayerId: anchor,
      activeLayerId: targetLayerId
    };
  }

  if (gesture.toggle) {
    const selected = new Set(state.selectedLayerIds);
    const removing = selected.has(targetLayerId) && selected.size > 1;
    if (removing) selected.delete(targetLayerId);
    else selected.add(targetLayerId);
    const activeLayerId = removing && state.activeLayerId && selected.has(state.activeLayerId)
      ? state.activeLayerId
      : removing ? [...selected][0] ?? null : targetLayerId;
    return {
      selectedLayerIds: [...selected],
      anchorLayerId: targetLayerId,
      activeLayerId
    };
  }

  return {
    selectedLayerIds: [targetLayerId],
    anchorLayerId: targetLayerId,
    activeLayerId: targetLayerId
  };
};

export class LayerNameRenameGestureController {
  private gesture: { layerId: LayerId; startedAt: number; eligible: boolean } | null = null;

  begin(layerId: LayerId, activeLayerId: LayerId | null, startedAt: number): void {
    if (!this.gesture || this.gesture.layerId !== layerId
      || startedAt - this.gesture.startedAt > 500) {
      this.gesture = { layerId, startedAt, eligible: activeLayerId === layerId };
      return;
    }
    this.gesture = { ...this.gesture, startedAt };
  }

  consume(layerId: LayerId): boolean {
    const eligible = this.gesture?.layerId === layerId && this.gesture.eligible;
    this.gesture = null;
    return eligible;
  }

  cancel(): void {
    this.gesture = null;
  }
}
