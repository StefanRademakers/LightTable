import { describe, expect, it, vi } from 'vitest';
import {
  RenderInvalidationScheduler,
  type AnimationFrameHost
} from './renderInvalidationScheduler';

const createFrameHost = () => {
  let nextHandle = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  const host: AnimationFrameHost = {
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
    run(handle = 1) {
      const callback = callbacks.get(handle);
      callbacks.delete(handle);
      callback?.(0);
    }
  };
};

describe('RenderInvalidationScheduler', () => {
  it('coalesces repeated invalidations into one frame', () => {
    const frames = createFrameHost();
    const render = vi.fn();
    const scheduler = new RenderInvalidationScheduler(render, frames.host);

    expect(scheduler.invalidate()).toBe(true);
    expect(scheduler.invalidate()).toBe(false);
    expect(frames.host.request).toHaveBeenCalledTimes(1);
    expect(scheduler.hasPendingFrame).toBe(true);

    frames.run();

    expect(render).toHaveBeenCalledTimes(1);
    expect(scheduler.hasPendingFrame).toBe(false);
  });

  it('flushes immediately and cancels the queued browser frame', () => {
    const frames = createFrameHost();
    const render = vi.fn();
    const scheduler = new RenderInvalidationScheduler(render, frames.host);

    scheduler.invalidate();
    expect(scheduler.flush()).toBe(true);

    expect(frames.host.cancel).toHaveBeenCalledWith(1);
    expect(render).toHaveBeenCalledTimes(1);
    frames.run();
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('allows a render callback to invalidate a following frame', () => {
    const frames = createFrameHost();
    let scheduler: RenderInvalidationScheduler;
    const render = vi.fn(() => scheduler.invalidate());
    scheduler = new RenderInvalidationScheduler(render, frames.host);

    scheduler.invalidate();
    frames.run(1);

    expect(render).toHaveBeenCalledTimes(1);
    expect(scheduler.hasPendingFrame).toBe(true);
    expect(frames.host.request).toHaveBeenCalledTimes(2);
  });

  it('cancels terminal work and rejects later invalidations', () => {
    const frames = createFrameHost();
    const render = vi.fn();
    const scheduler = new RenderInvalidationScheduler(render, frames.host);

    scheduler.invalidate();
    scheduler.dispose();

    expect(frames.host.cancel).toHaveBeenCalledWith(1);
    expect(scheduler.hasPendingFrame).toBe(false);
    expect(scheduler.invalidate()).toBe(false);
    expect(scheduler.flush()).toBe(false);
    frames.run();
    expect(render).not.toHaveBeenCalled();
  });
});
