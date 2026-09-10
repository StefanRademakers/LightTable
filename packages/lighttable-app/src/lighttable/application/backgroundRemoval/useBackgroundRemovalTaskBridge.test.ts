import { describe, expect, it, vi } from 'vitest';
import type { LightTableCommandResult } from '../commands/lightTableCommandContract';
import { BackgroundRemovalTaskCorrelation } from './useBackgroundRemovalTaskBridge';

describe('BackgroundRemovalTaskCorrelation', () => {
  it('cancels a task that is accepted after pending admission was invalidated', async () => {
    let admit!: (result: LightTableCommandResult) => void;
    const execute = vi.fn((command: 'layer.removeBackground' | 'task.cancel') => (
      command === 'layer.removeBackground'
        ? new Promise<LightTableCommandResult>((resolve) => { admit = resolve; })
        : Promise.resolve({ status: 'completed' } as LightTableCommandResult)
    ));
    const correlation = new BackgroundRemovalTaskCorrelation();
    const starting = correlation.start(execute, 'photo' as never, 'replace');

    expect(correlation.cancel(execute)).toBe(false);
    admit({ status: 'accepted', taskId: 'late-task' } as LightTableCommandResult);

    await expect(starting).resolves.toBe(false);
    expect(execute).toHaveBeenLastCalledWith('task.cancel', { taskId: 'late-task' });
  });
});
