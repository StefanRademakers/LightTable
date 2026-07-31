import { describe, expect, it, vi } from 'vitest';
import { createWarpPreviewScheduler } from './warpPreviewScheduler';

describe('Warp preview scheduler', () => {
  it('publishes only the latest preview per frame and flushes synchronously', () => {
    let frameCallback: (() => void) | null = null;
    const cancel = vi.fn();
    const scheduler = createWarpPreviewScheduler({
      request: (callback) => {
        frameCallback = callback;
        return 7;
      },
      cancel
    });
    const first = vi.fn();
    const latest = vi.fn();

    scheduler.schedule(first);
    scheduler.schedule(latest);
    expect(first).not.toHaveBeenCalled();
    expect(latest).not.toHaveBeenCalled();

    (frameCallback as (() => void) | null)?.();
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);

    const committed = vi.fn();
    scheduler.schedule(committed);
    scheduler.flush();
    expect(cancel).toHaveBeenCalledWith(7);
    expect(committed).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending preview without publishing it', () => {
    const task = vi.fn();
    const cancel = vi.fn();
    const scheduler = createWarpPreviewScheduler({
      request: () => 11,
      cancel
    });

    scheduler.schedule(task);
    scheduler.cancel();
    scheduler.flush();

    expect(cancel).toHaveBeenCalledWith(11);
    expect(task).not.toHaveBeenCalled();
  });
});
