import { describe, expect, it, vi } from 'vitest';
import type { DocumentSessionId } from '../lighttable/application/documents/documentSession';
import { DocumentRecoveryTransitionGate } from './DocumentRecoveryTransitionGate';

const id = (value: string) => value as DocumentSessionId;

describe('DocumentRecoveryTransitionGate', () => {
  it('flushes the active owner before activating another document', async () => {
    const gate = new DocumentRecoveryTransitionGate();
    const order: string[] = [];
    gate.setActiveDocument(id('a'));
    gate.register(id('a'), async () => { order.push('flush'); });
    await gate.activateLatest(id('b'), () => { order.push('activate'); });
    expect(order).toEqual(['flush', 'activate']);
  });

  it('does not activate when the recovery barrier rejects', async () => {
    const gate = new DocumentRecoveryTransitionGate();
    const activate = vi.fn();
    gate.setActiveDocument(id('a'));
    gate.register(id('a'), () => Promise.reject(new Error('disk unavailable')));
    await expect(gate.activateLatest(id('b'), activate)).rejects.toThrow('disk unavailable');
    expect(activate).not.toHaveBeenCalled();
  });

  it('lets only the latest overlapping activation request win', async () => {
    const gate = new DocumentRecoveryTransitionGate();
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const activate = vi.fn();
    gate.setActiveDocument(id('a'));
    gate.register(id('a'), () => barrier);
    const first = gate.activateLatest(id('b'), activate);
    const second = gate.activateLatest(id('c'), activate);
    release();
    await Promise.all([first, second]);
    expect(activate).toHaveBeenCalledOnce();
    expect(activate).toHaveBeenCalledWith(id('c'));
  });

  it('serializes admitted transitions and flushes the exact active owner before each', async () => {
    const gate = new DocumentRecoveryTransitionGate();
    const order: string[] = [];
    let finishFirst!: () => void;
    let firstStarted!: () => void;
    const firstPending = new Promise<void>((resolve) => { finishFirst = resolve; });
    const started = new Promise<void>((resolve) => { firstStarted = resolve; });
    gate.setActiveDocument(id('a'));
    gate.register(id('a'), async () => { order.push('flush'); });
    const first = gate.runTransition(async () => {
      order.push('first-start');
      firstStarted();
      await firstPending;
      order.push('first-end');
    });
    const second = gate.runTransition(() => { order.push('second'); });
    await started;
    expect(order).toEqual(['flush', 'first-start']);
    finishFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(['flush', 'first-start', 'first-end', 'flush', 'second']);
  });

  it('serializes failed-open discard without flushing the unusable active renderer', async () => {
    const gate = new DocumentRecoveryTransitionGate();
    const flush = vi.fn(async () => { throw new Error('Renderer recovery is unavailable.'); });
    gate.setActiveDocument(id('failed'));
    gate.register(id('failed'), flush);

    await expect(gate.runFailedOpenDiscard(() => 'discarded')).resolves.toBe('discarded');
    expect(flush).not.toHaveBeenCalled();
  });

  it('blocks transitions while application close owns admission', async () => {
    const gate = new DocumentRecoveryTransitionGate();
    gate.setActiveDocument(id('a'));
    const release = await gate.acquireBarrier('Application close is pending.');
    await expect(gate.flushActive()).rejects.toThrow('Application close is pending.');
    release();
    await expect(gate.flushActive()).resolves.toBeUndefined();
  });

  it('admits a barrier only after an already-started transition drains', async () => {
    const gate = new DocumentRecoveryTransitionGate();
    let finish!: () => void;
    const operation = new Promise<void>((resolve) => { finish = resolve; });
    const transition = gate.runTransition(() => operation);
    let admitted = false;
    const barrier = gate.acquireBarrier('closing').then((release) => {
      admitted = true;
      return release;
    });
    await Promise.resolve();
    expect(admitted).toBe(false);
    finish();
    await transition;
    const release = await barrier;
    expect(admitted).toBe(true);
    release();
  });
});
