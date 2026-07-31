import { describe, expect, it, vi } from 'vitest';
import { createWarpHoldScheduler } from './warpHoldScheduler';

describe('Warp hold scheduler', () => {
  it('emits bounded quanta without catching up missed frames', () => {
    let callback: ((timeMs: number) => void) | null = null;
    const task = vi.fn();
    const scheduler = createWarpHoldScheduler({
      request: (next) => {
        callback = next;
        return 1;
      },
      cancel: vi.fn()
    }, 50);
    scheduler.start(task);
    const run = (timeMs: number) => (callback as ((value: number) => void))(timeMs);
    run(100);
    run(120);
    run(151);
    run(400);
    expect(task.mock.calls.map(([timeMs]) => timeMs)).toEqual([151, 400]);
  });

  it('stops the pending frame and cannot emit afterwards', () => {
    const callbacks: Array<(timeMs: number) => void> = [];
    const cancel = vi.fn();
    const task = vi.fn();
    const scheduler = createWarpHoldScheduler({
      request: (next) => {
        callbacks.push(next);
        return 7;
      },
      cancel
    });
    scheduler.start(task);
    scheduler.stop();
    expect(cancel).toHaveBeenCalledWith(7);
    callbacks[0]?.(100);
    expect(task).not.toHaveBeenCalled();
  });
});
