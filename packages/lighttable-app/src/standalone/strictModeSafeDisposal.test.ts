import { describe, expect, it, vi } from 'vitest';
import { StrictModeSafeDisposal } from './strictModeSafeDisposal';

describe('StrictModeSafeDisposal', () => {
  it('uses its production microtask scheduler without a browser host receiver', async () => {
    const dispose = vi.fn();
    const lifecycle = new StrictModeSafeDisposal(dispose);

    lifecycle.connect()();
    await Promise.resolve();

    expect(dispose).toHaveBeenCalledOnce();
  });

  it('keeps a resource alive across a Strict Mode reconnect', () => {
    const queued: Array<() => void> = [];
    const dispose = vi.fn();
    const lifecycle = new StrictModeSafeDisposal(dispose, (work) => {
      queued.push(work);
    });

    const disconnectFirstMount = lifecycle.connect();
    disconnectFirstMount();
    lifecycle.connect();
    queued.splice(0).forEach((work) => work());

    expect(dispose).not.toHaveBeenCalled();
  });

  it('disposes exactly once after a terminal disconnect', () => {
    const queued: Array<() => void> = [];
    const dispose = vi.fn();
    const lifecycle = new StrictModeSafeDisposal(dispose, (work) => {
      queued.push(work);
    });

    const disconnect = lifecycle.connect();
    disconnect();
    queued.splice(0).forEach((work) => work());

    expect(dispose).toHaveBeenCalledOnce();
  });

  it('invokes a host scheduler without binding the lifecycle as `this`', () => {
    const dispose = vi.fn();
    const scheduled: Array<() => void> = [];
    const schedule = function (
      this: StrictModeSafeDisposal | undefined,
      work: () => void
    ) {
      if (this instanceof StrictModeSafeDisposal) {
        throw new TypeError('Illegal invocation');
      }
      scheduled.push(work);
    };
    const lifecycle = new StrictModeSafeDisposal(dispose, schedule);

    lifecycle.connect()();
    scheduled.splice(0).forEach((work) => work());

    expect(dispose).toHaveBeenCalledOnce();
  });
});
