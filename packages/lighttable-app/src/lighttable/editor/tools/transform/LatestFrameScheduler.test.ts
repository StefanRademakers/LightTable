import { describe, expect, it, vi } from 'vitest';
import { LatestFrameScheduler } from './LatestFrameScheduler';

describe('LatestFrameScheduler', () => {
  it('publishes only the newest pointer sample in a display frame', () => {
    let callback: FrameRequestCallback | null = null;
    const scheduler = new LatestFrameScheduler(
      (next) => { callback = next; return 7; },
      vi.fn()
    );
    const published: number[] = [];

    scheduler.schedule(() => published.push(1));
    scheduler.schedule(() => published.push(2));
    scheduler.schedule(() => published.push(3));
    callback!(0);

    expect(published).toEqual([3]);
  });

  it('flushes the latest sample before a pointer-up commit', () => {
    const cancelFrame = vi.fn();
    const scheduler = new LatestFrameScheduler(() => 11, cancelFrame);
    const published: string[] = [];
    scheduler.schedule(() => published.push('latest'));

    scheduler.flush();

    expect(published).toEqual(['latest']);
    expect(cancelFrame).toHaveBeenCalledWith(11);
  });

  it('drops pending work when the overlay is destroyed', () => {
    const cancelFrame = vi.fn();
    const scheduler = new LatestFrameScheduler(() => 13, cancelFrame);
    const task = vi.fn();
    scheduler.schedule(task);

    scheduler.cancel();
    scheduler.flush();

    expect(task).not.toHaveBeenCalled();
    expect(cancelFrame).toHaveBeenCalledWith(13);
  });
});
