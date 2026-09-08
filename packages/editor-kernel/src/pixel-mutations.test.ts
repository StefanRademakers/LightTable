import { describe, expect, it, vi } from 'vitest';
import { AppliedPixelMutationCoordinator, type ReversiblePixelMutationStep } from './pixel-mutations';

const step = (name: string, calls: string[]): ReversiblePixelMutationStep => ({
  byteSize: 4,
  apply: vi.fn((direction) => { calls.push(`${direction}:${name}`); return true; }),
  dispose: vi.fn(),
});

describe('AppliedPixelMutationCoordinator', () => {
  it('publishes once and replays in dependency order', () => {
    const calls: string[] = [];
    const entries: any[] = [];
    const coordinator = new AppliedPixelMutationCoordinator<string>(() => ({
      applyState: (state) => calls.push(`state:${state}`),
      appendHistory: (entry) => { calls.push('history'); entries.push(entry); },
    }));
    coordinator.commit({ operation: 'Mask', before: 'before', after: 'after',
      steps: [step('a', calls), step('b', calls)] }, (lifecycle) => lifecycle);
    expect(calls).toEqual(['state:after', 'history']);
    entries[0].undo();
    expect(calls.slice(2)).toEqual(['undo:b', 'undo:a', 'state:before']);
  });

  it('prepares a removed target before undo and compensates partial failure', () => {
    const calls: string[] = [];
    const first = step('first', calls);
    const second = step('second', calls);
    vi.mocked(first.apply).mockImplementation((direction) => {
      calls.push(`${direction}:first`);
      return direction !== 'undo';
    });
    let entry: any;
    const coordinator = new AppliedPixelMutationCoordinator<string>(() => ({
      applyState: (state) => calls.push(`state:${state}`),
      appendHistory: (value) => { entry = value; },
    }));
    coordinator.commit({ operation: 'Delete mask', before: 'with-mask',
      undoBase: 'prepared-mask', after: 'without-mask', steps: [first, second] },
    (lifecycle) => lifecycle);
    calls.length = 0;
    expect(() => entry.undo()).toThrow('Delete mask undo is no longer available.');
    expect(calls).toEqual([
      'state:prepared-mask', 'undo:second', 'undo:first', 'redo:second',
      'state:without-mask',
    ]);
  });

  it('rolls an applied mutation back before publishing its canonical before state', () => {
    const calls: string[] = [];
    const a = step('a', calls);
    const b = step('b', calls);
    const coordinator = new AppliedPixelMutationCoordinator<string>(() => ({
      applyState: (state) => calls.push(`state:${state}`),
      appendHistory: () => { throw new Error('history rejected'); },
    }));
    expect(() => coordinator.commit({
      operation: 'Add mask', before: 'before', undoBase: 'rollback-base', after: 'after',
      steps: [a, b]
    }, (lifecycle) => lifecycle)).toThrow('history rejected');
    expect(calls).toEqual([
      'state:after', 'state:rollback-base', 'undo:b', 'undo:a', 'state:before'
    ]);
    expect(a.dispose).toHaveBeenCalledOnce();
    expect(b.dispose).toHaveBeenCalledOnce();
  });

  it('detects a failed commit rollback and retains its recovery snapshots', () => {
    const calls: string[] = [];
    const a = step('a', calls);
    const b = step('b', calls);
    vi.mocked(a.apply).mockImplementation((direction) => {
      calls.push(`${direction}:a`);
      return direction !== 'undo';
    });
    const coordinator = new AppliedPixelMutationCoordinator<string>(() => ({
      applyState: (state) => calls.push(`state:${state}`),
      appendHistory: () => { throw new Error('history rejected'); },
    }));
    expect(() => coordinator.commit({
      operation: 'New result layer', before: 'before', redoBase: 'prepared', after: 'after',
      steps: [a, b]
    }, (lifecycle) => lifecycle)).toThrow(
      'New result layer commit failed and was restored to its applied state.'
    );
    expect(calls).toEqual([
      'state:after', 'state:prepared', 'undo:b', 'undo:a', 'redo:b', 'state:after'
    ]);
    expect(a.dispose).not.toHaveBeenCalled();
    expect(b.dispose).not.toHaveBeenCalled();
  });
});
