import { afterEach, describe, expect, it, vi } from 'vitest';
import { abortableDelay } from './abortableDelay';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('abortableDelay', () => {
  it('detaches every listener after repeated waits complete normally', async () => {
    vi.useFakeTimers();
    const signal = new AbortController().signal;
    const add = vi.spyOn(signal, 'addEventListener');
    const remove = vi.spyOn(signal, 'removeEventListener');

    for (let round = 1; round <= 250; round += 1) {
      const wait = abortableDelay(125, signal);
      expect(add).toHaveBeenCalledTimes(round);
      await vi.advanceTimersByTimeAsync(125);
      await wait;
      expect(remove).toHaveBeenCalledTimes(round);
      expect(remove.mock.calls.at(-1)?.[1]).toBe(add.mock.calls.at(-1)?.[1]);
      expect(vi.getTimerCount()).toBe(0);
    }

    expect(signal.aborted).toBe(false);
  });

  it('detaches its listener and preserves the reason when aborted', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const reason = new Error('cancel generation');
    const wait = abortableDelay(10_000, controller.signal);

    controller.abort(reason);

    await expect(wait).rejects.toBe(reason);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects an already-aborted signal without registering work', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const reason = new Error('already cancelled');
    controller.abort(reason);
    const add = vi.spyOn(controller.signal, 'addEventListener');

    await expect(abortableDelay(1_000, controller.signal)).rejects.toBe(reason);

    expect(add).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
