import { describe, expect, it, vi } from 'vitest';
import { createInteractionTransitionCoordinator } from './InteractionTransitionCoordinator';

describe('InteractionTransitionCoordinator', () => {
  it('preserves mounted interactions across host presentation loss', async () => {
    const settle = vi.fn(async () => undefined);
    const cancel = vi.fn();
    const coordinator = createInteractionTransitionCoordinator({
      settleMountedInteraction: settle,
      cancelMountedInteraction: cancel,
      reportFailure: vi.fn()
    });

    expect(await coordinator.request('preserve')).toEqual({ status: 'admitted' });
    expect(settle).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });

  it('serializes overlapping adjustment and command admission behind settlement', async () => {
    let releaseFirst: () => void = () => undefined;
    const firstSettlement = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const events: string[] = [];
    const settle = vi.fn()
      .mockImplementationOnce(async () => { events.push('settle-1'); await firstSettlement; })
      .mockImplementationOnce(async () => { events.push('settle-2'); });
    const coordinator = createInteractionTransitionCoordinator({
      settleMountedInteraction: settle,
      cancelMountedInteraction: vi.fn(),
      reportFailure: vi.fn()
    });

    const adjustment = coordinator.request('commit-before-mutation').then((result) => {
      events.push(`adjustment:${result.status}`);
      return result;
    });
    const command = coordinator.request('commit-before-mutation').then((result) => {
      events.push(`command:${result.status}`);
      return result;
    });
    await Promise.resolve();
    expect(events).toEqual(['settle-1']);
    releaseFirst();

    expect(await adjustment).toEqual({ status: 'admitted' });
    expect(await command).toEqual({ status: 'admitted' });
    expect(events).toEqual([
      'settle-1', 'adjustment:admitted', 'settle-2', 'command:admitted'
    ]);
  });

  it('reports settlement failure and rejects without throwing', async () => {
    const reportFailure = vi.fn();
    const coordinator = createInteractionTransitionCoordinator({
      settleMountedInteraction: async () => { throw new Error('GPU finalization failed'); },
      cancelMountedInteraction: vi.fn(),
      reportFailure
    });

    expect(await coordinator.request('commit-before-mutation')).toEqual({
      status: 'rejected',
      reason: 'Could not finish the active document interaction: GPU finalization failed'
    });
    expect(reportFailure).toHaveBeenCalledWith(
      'Could not finish the active document interaction: GPU finalization failed'
    );
  });

  it('invalidates queued mutation admission when the document retires', async () => {
    let releaseSettlement: () => void = () => undefined;
    const settlement = new Promise<void>((resolve) => { releaseSettlement = resolve; });
    const cancel = vi.fn();
    const coordinator = createInteractionTransitionCoordinator({
      settleMountedInteraction: async () => settlement,
      cancelMountedInteraction: cancel,
      reportFailure: vi.fn()
    });

    const pending = coordinator.request('commit-before-mutation');
    await Promise.resolve();
    expect(await coordinator.request('cancel-on-document-retire')).toEqual({ status: 'admitted' });
    releaseSettlement();

    expect(await pending).toEqual({
      status: 'rejected',
      reason: 'The document interaction was retired during mutation admission.'
    });
    expect(cancel).toHaveBeenCalledOnce();
  });
});
