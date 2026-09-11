import type { EditorSession, ToolId } from '../../editor/session/editorSession';
import { toolShortcutGroupFor } from '../../editor/tools/toolRegistry';
import { brushPresetChange, resolveBrushPreset } from '../../editor/tools/brush/brushPresets';
import { planPersistentToolActivation } from './persistentToolActivation';

export type ToolActivationOutcome = 'activated' | 'superseded' | 'retired';

export interface PersistentToolActivationBinding {
  /** Captured workspace-session identity and concrete renderer generation. */
  isCurrent(): boolean;
  currentTool(): ToolId;
  clearCrop(): void;
  readonly text: {
    cancelCreation(): void;
    finishEditing(): void;
  };
  readonly warp: { isActive(): boolean; reset(): void };
  readonly faceWarp: { reset(): void; resetDetection(): void };
  readonly transform: { isActive(): boolean; hasPendingWork(): boolean; begin(): Promise<void> };
  /** Existing transition admission owns settlement; this is not a command queue. */
  settleInteraction(): Promise<void>;
  readonly selection: { hasDraft(): boolean; reset(): void };
  publishTool(tool: ToolId): void;
}

/** Editor-lifetime preferences and persistent-tool activation ordering only. */
export class PersistentToolActivationOwner {
  readonly preferredTools: Partial<Record<string, ToolId>> = {};
  private requestRevision = 0;
  private pendingSettlement: Promise<void> | null = null;

  retire(): void {
    this.requestRevision += 1;
  }

  async activate(
    requestedTool: ToolId,
    binding: PersistentToolActivationBinding,
    afterActivation?: () => void
  ): Promise<ToolActivationOutcome> {
    const requestRevision = ++this.requestRevision;
    if (!binding.isCurrent()) return 'retired';
    const currentTool = binding.currentTool();
    const pendingTransform = binding.transform.hasPendingWork();
    const hadPendingSettlement = this.pendingSettlement !== null;
    const plan = planPersistentToolActivation(
      currentTool, requestedTool, binding.transform.isActive()
    );
    // A launch or previous terminal may be pending even after isActive() became
    // false. Never publish the successor merely because its gizmo disappeared.
    if (plan.finishTransform || pendingTransform || this.pendingSettlement
      || (currentTool === 'transform' && plan.nextTool !== null)) {
      const settlement = binding.settleInteraction();
      this.pendingSettlement = settlement;
      try {
        await settlement;
      } finally {
        if (this.pendingSettlement === settlement) this.pendingSettlement = null;
      }
    }
    if (!binding.isCurrent()) return 'retired';
    if (requestRevision !== this.requestRevision || binding.currentTool() !== currentTool) return 'superseded';
    binding.clearCrop();
    const group = toolShortcutGroupFor(requestedTool);
    if (group) this.preferredTools[group.key] = requestedTool;
    if (requestedTool !== currentTool) binding.text.cancelCreation();
    if (requestedTool !== 'text-point' && requestedTool !== 'text-vertical') {
      binding.text.finishEditing();
    }
    if (currentTool === 'warp' && requestedTool !== 'warp' && binding.warp.isActive()) binding.warp.reset();
    if (currentTool === 'face-warp' && requestedTool !== 'face-warp') {
      binding.faceWarp.reset();
      binding.faceWarp.resetDetection();
    }
    if (plan.restartTransform && !pendingTransform && !hadPendingSettlement) {
      await binding.transform.begin();
      if (!binding.isCurrent()) return 'retired';
      if (requestRevision !== this.requestRevision) return 'superseded';
    }
    if (plan.nextTool) {
      if ((binding.selection.hasDraft() || currentTool === 'select-magic-wand')
        && currentTool !== plan.nextTool) binding.selection.reset();
      binding.publishTool(plan.nextTool);
    }
    afterActivation?.();
    return 'activated';
  }
}

/** Tool preference update only; never authors pixels, selection or history. */
export const applyPersistentToolPreference = (
  current: EditorSession, nextTool: ToolId
): EditorSession => {
  const requiresPaintTip = (nextTool === 'clone-stamp' || nextTool === 'healing-brush')
    && resolveBrushPreset(current.brush.presetId).engine !== 'paint';
  if (current.activeTool === nextTool && !requiresPaintTip) return current;
  return {
    ...current,
    activeTool: nextTool,
    brush: requiresPaintTip ? { ...current.brush, ...brushPresetChange('round') } : current.brush
  };
};
