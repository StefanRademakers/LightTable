import { useCallback, useRef } from 'react';
import type { LightTableCommandResult } from '../commands/lightTableCommandContract';
import type { LayerId } from '../../editor/document/documentTypes';
import type { BackgroundRemovalMaskMode } from './useBackgroundRemovalController';

type ExecuteTaskCommand = (
  command: 'layer.removeBackground' | 'task.cancel',
  parameters: unknown
) => Promise<LightTableCommandResult> | null;

/** Keeps task admission and cancellation ordered even while command admission is pending. */
export class BackgroundRemovalTaskCorrelation {
  private taskId: string | null = null;
  private generation = 0;

  async start(
    execute: ExecuteTaskCommand,
    layerId: LayerId,
    mode: BackgroundRemovalMaskMode
  ): Promise<boolean> {
    const generation = ++this.generation;
    const execution = execute('layer.removeBackground', { layerId, mode });
    if (!execution) return false;
    const result = await execution;
    if (result.status !== 'accepted') return false;
    if (generation !== this.generation) {
      void execute('task.cancel', { taskId: result.taskId });
      return false;
    }
    this.taskId = result.taskId;
    return true;
  }

  cancel(execute: ExecuteTaskCommand): boolean {
    const taskId = this.taskId;
    this.generation += 1;
    this.taskId = null;
    if (!taskId) return false;
    void execute('task.cancel', { taskId });
    return true;
  }

  clearCompleted(): void {
    this.taskId = null;
  }
}

/** Owns the UI command/task correlation only; document task generation and
 * result admission remain in the task registry and background controller. */
export const useBackgroundRemovalTaskBridge = (execute: ExecuteTaskCommand) => {
  const correlationRef = useRef(new BackgroundRemovalTaskCorrelation());

  const startTask = useCallback((layerId: LayerId, mode: BackgroundRemovalMaskMode) =>
    correlationRef.current.start(execute, layerId, mode), [execute]);

  const cancelTask = useCallback(() => correlationRef.current.cancel(execute), [execute]);

  const clearCompletedTask = useCallback(() => {
    correlationRef.current.clearCompleted();
  }, []);

  return { startTask, cancelTask, clearCompletedTask } as const;
};
