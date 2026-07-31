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
    run(handle = 1, timestamp = 0) {
      const callback = callbacks.get(handle);
      callbacks.delete(handle);
      callback?.(timestamp);
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

  it('retains one dirty render while paused and submits it after resume', () => {
    const frames = createFrameHost();
    const render = vi.fn();
    const scheduler = new RenderInvalidationScheduler(render, frames.host);

    scheduler.invalidate();
    scheduler.setPaused(true);
    expect(frames.host.cancel).toHaveBeenCalledWith(1);
    expect(scheduler.hasPendingFrame).toBe(false);
    expect(scheduler.hasPendingInvalidation).toBe(true);

    expect(scheduler.invalidate()).toBe(false);
    expect(frames.host.request).toHaveBeenCalledTimes(1);
    scheduler.setPaused(false);
    expect(frames.host.request).toHaveBeenCalledTimes(2);

    frames.run(2);
    expect(render).toHaveBeenCalledOnce();
    expect(scheduler.hasPendingInvalidation).toBe(false);
  });

  it('accepts invalidations raised entirely while paused', () => {
    const frames = createFrameHost();
    const render = vi.fn();
    const scheduler = new RenderInvalidationScheduler(render, frames.host);

    scheduler.setPaused(true);
    expect(scheduler.invalidate()).toBe(true);
    expect(scheduler.invalidate()).toBe(false);
    expect(frames.host.request).not.toHaveBeenCalled();

    scheduler.setPaused(false);
    frames.run();
    expect(render).toHaveBeenCalledOnce();
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

  it('retains only the newest invalidation while an interactive frame cap is active', () => {
    const frames = createFrameHost();
    const render = vi.fn();
    const scheduler = new RenderInvalidationScheduler(render, frames.host);

    scheduler.setMinimumFrameInterval(30);
    scheduler.invalidate();
    frames.run(1, 0);
    expect(render).toHaveBeenCalledTimes(1);

    scheduler.invalidate();
    frames.run(2, 16);
    expect(render).toHaveBeenCalledTimes(1);
    expect(scheduler.hasPendingInvalidation).toBe(true);
    expect(scheduler.hasPendingFrame).toBe(true);

    scheduler.invalidate();
    frames.run(3, 33);
    expect(render).toHaveBeenCalledTimes(2);
    expect(scheduler.hasPendingInvalidation).toBe(false);
  });

  it('restores full-rate rendering immediately when the frame cap is removed', () => {
    const frames = createFrameHost();
    const render = vi.fn();
    const scheduler = new RenderInvalidationScheduler(render, frames.host);

    scheduler.setMinimumFrameInterval(30);
    scheduler.invalidate();
    frames.run(1, 100);
    scheduler.invalidate();
    frames.run(2, 110);
    expect(render).toHaveBeenCalledOnce();

    scheduler.setMinimumFrameInterval(0);
    frames.run(3, 111);
    expect(render).toHaveBeenCalledTimes(2);
  });
});
