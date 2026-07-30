import { describe, expect, it, vi } from 'vitest';
import { StrictModeSafeDisposal } from './strictModeSafeDisposal';

describe('StrictModeSafeDisposal', () => {
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
});
