import { useCallback, useRef } from 'react';
import type { LightTableCommandResult } from '../commands/lightTableCommandContract';
import type { LayerId } from '../../editor/document/documentTypes';
import type { BackgroundRemovalMaskMode } from './useBackgroundRemovalController';

type ExecuteTaskCommand = (
  command: 'layer.removeBackground' | 'task.cancel',
  parameters: unknown
) => Promise<LightTableCommandResult> | null;

/** Owns the UI command/task correlation only; document task generation and
 * result admission remain in the task registry and background controller. */
export const useBackgroundRemovalTaskBridge = (execute: ExecuteTaskCommand) => {
  const taskIdRef = useRef<string | null>(null);
  const requestGenerationRef = useRef(0);

  const startTask = useCallback(async (layerId: LayerId, mode: BackgroundRemovalMaskMode) => {
    const generation = ++requestGenerationRef.current;
    const execution = execute('layer.removeBackground', { layerId, mode });
    if (!execution) return false;
    const result = await execution;
    if (result.status !== 'accepted') return false;
    if (generation !== requestGenerationRef.current) {
      void execute('task.cancel', { taskId: result.taskId });
      return false;
    }
    taskIdRef.current = result.taskId;
    return true;
  }, [execute]);

  const cancelTask = useCallback(() => {
    const taskId = taskIdRef.current;
    if (!taskId) return false;
    requestGenerationRef.current += 1;
    taskIdRef.current = null;
    void execute('task.cancel', { taskId });
    return true;
  }, [execute]);

  const clearCompletedTask = useCallback(() => {
    taskIdRef.current = null;
  }, []);

  return { startTask, cancelTask, clearCompletedTask } as const;
};
