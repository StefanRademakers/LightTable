import type { FlowTextEditingSessionController } from './flowTextEditingSession';

/** Runs a workspace transition only after the active text group is durable. */
export const runAfterTextEditingTerminal = (
  controller: Pick<FlowTextEditingSessionController, 'getSnapshot' | 'finish'>,
  transition: () => void
) => {
  const editing = controller.getSnapshot();
  if (editing.status === 'editing' && !controller.finish()) return false;
  transition();
  return true;
};
