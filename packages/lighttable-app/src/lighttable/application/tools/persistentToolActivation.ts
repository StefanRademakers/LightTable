import type { ToolId } from '../../editor/session/editorSession';

export interface PersistentToolActivationPlan {
  readonly finishTransform: boolean;
  readonly restartTransform: boolean;
  readonly nextTool: ToolId | null;
}

/**
 * Plans a persistent tool switch without owning React or renderer state.
 * Transform is special because leaving it commits the current preview and
 * activating it a second time acts as an explicit commit.
 */
export const planPersistentToolActivation = (
  currentTool: ToolId,
  requestedTool: ToolId,
  transformActive: boolean
): PersistentToolActivationPlan => {
  if (currentTool === requestedTool) {
    if (requestedTool === 'transform') {
      return transformActive
        ? { finishTransform: true, restartTransform: false, nextTool: null }
        : { finishTransform: false, restartTransform: true, nextTool: null };
    }
    return { finishTransform: false, restartTransform: false, nextTool: null };
  }
  return {
    finishTransform: transformActive && requestedTool !== 'transform',
    restartTransform: false,
    nextTool: requestedTool
  };
};
