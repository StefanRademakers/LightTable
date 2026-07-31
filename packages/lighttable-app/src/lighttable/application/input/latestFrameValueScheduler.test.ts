import { describe, expect, it, vi } from 'vitest';
import {
  LatestFrameValueScheduler,
  type InputAnimationFrameHost
} from './latestFrameValueScheduler';

const createFrameHost = () => {
  let nextHandle = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  const host: InputAnimationFrameHost = {
    request: vi.fn((callback) => {
      const handle = nextHandle++;
      callbacks.set(handle, callback);
      return handle;
    }),
    cancel: vi.fn((handle) => {
      callbacks.delete(handle);
    })
  };
  return {
    host,
    runNext: () => {
      const entry = callbacks.entries().next().value as
        | [number, FrameRequestCallback]
        | undefined;
      if (!entry) return;
      callbacks.delete(entry[0]);
      entry[1](16);
    }
  };
};

describe('LatestFrameValueScheduler', () => {
  it('publishes only the newest value once per animation frame', () => {
    const frame = createFrameHost();
    const publish = vi.fn();
    const scheduler = new LatestFrameValueScheduler(publish, frame.host);

    scheduler.schedule(1);
    scheduler.schedule(2);
    scheduler.schedule(3);

    expect(scheduler.pending()).toBe(3);
    expect(frame.host.request).toHaveBeenCalledOnce();
    expect(publish).not.toHaveBeenCalled();
    frame.runNext();
    expect(scheduler.pending()).toBeUndefined();
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(3);
  });

  it('flushes the final gesture value and cancels its queued frame', () => {
    const frame = createFrameHost();
    const publish = vi.fn();
    const scheduler = new LatestFrameValueScheduler(publish, frame.host);

    scheduler.schedule({ x: 12, y: 8 });

    expect(scheduler.flush()).toBe(true);
    expect(frame.host.cancel).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith({ x: 12, y: 8 });
    frame.runNext();
    expect(publish).toHaveBeenCalledOnce();
  });

  it('does not publish cancelled or disposed input', () => {
    const frame = createFrameHost();
    const publish = vi.fn();
    const scheduler = new LatestFrameValueScheduler(publish, frame.host);

    scheduler.schedule('old-document');
    expect(scheduler.cancel()).toBe(true);
    frame.runNext();
    scheduler.dispose();
    scheduler.schedule('disposed');

    expect(publish).not.toHaveBeenCalled();
  });
});
