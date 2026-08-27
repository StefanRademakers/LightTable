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

export class LayerNameRenameGestureController<ItemId extends string = LayerId> {
  private static readonly doubleClickWindowMs = 500;
  private gesture: {
    layerId: ItemId;
    firstStartedAt: number;
    lastStartedAt: number;
    pointerDownCount: number;
    eligible: boolean;
  } | null = null;

  begin(layerId: ItemId, activeLayerId: ItemId | null, startedAt: number): void {
    if (!this.gesture || this.gesture.layerId !== layerId
      || startedAt - this.gesture.lastStartedAt > LayerNameRenameGestureController.doubleClickWindowMs) {
      this.gesture = {
        layerId,
        firstStartedAt: startedAt,
        lastStartedAt: startedAt,
        pointerDownCount: 1,
        eligible: activeLayerId === layerId
      };
      return;
    }
    this.gesture = {
      ...this.gesture,
      lastStartedAt: startedAt,
      pointerDownCount: this.gesture.pointerDownCount + 1
    };
  }

  consume(layerId: ItemId, completedAt: number): boolean {
    const eligible = this.gesture?.layerId === layerId
      && this.gesture.eligible
      && this.gesture.pointerDownCount >= 2
      && completedAt - this.gesture.firstStartedAt
        <= LayerNameRenameGestureController.doubleClickWindowMs;
    this.gesture = null;
    return eligible;
  }

  cancel(): void {
    this.gesture = null;
  }
}
