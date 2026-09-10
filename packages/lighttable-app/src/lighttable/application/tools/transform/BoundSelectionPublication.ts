import type { SelectionMaskSnapshot } from '../../../editor/selection/SelectionMaskSnapshot';

export interface BoundSelectionRenderer {
  restoreSelectionSnapshot(snapshot: SelectionMaskSnapshot): Promise<boolean>;
}

/** Restores renderer selection state and publishes canonical state under one binding. */
export const publishBoundSelection = async (input: {
  renderer: BoundSelectionRenderer;
  beforeMask: SelectionMaskSnapshot;
  afterMask: SelectionMaskSnapshot;
  bindingIsCurrent(): boolean;
  rendererIsAddressable(): boolean;
  restoreBeforeOnPublishError?(reason: unknown): boolean;
  publish(): void;
}): Promise<void> => {
  if (!input.bindingIsCurrent()) {
    throw new Error('The transform renderer or selection lease is no longer current.');
  }
  if (!await input.renderer.restoreSelectionSnapshot(input.afterMask)) {
    throw new Error('The exact selection state could not be restored.');
  }
  if (!input.bindingIsCurrent()) {
    if (input.rendererIsAddressable()) {
      await input.renderer.restoreSelectionSnapshot(input.beforeMask);
    }
    throw new Error('The transform renderer or selection changed during restoration.');
  }
  try {
    input.publish();
  } catch (reason) {
    if ((input.restoreBeforeOnPublishError?.(reason) ?? true)
      && input.rendererIsAddressable()) {
      await input.renderer.restoreSelectionSnapshot(input.beforeMask);
    }
    throw reason;
  }
};
