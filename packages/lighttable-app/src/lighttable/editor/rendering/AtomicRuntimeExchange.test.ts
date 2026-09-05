import { describe, expect, it } from 'vitest';
import { applyAtomicRuntimeState, createAtomicRuntimeExchange } from './AtomicRuntimeExchange';

describe('AtomicRuntimeExchange', () => {
  it('moves all resources together through apply, undo and redo', () => {
    let first = 'first-before';
    let second = 'second-before';
    const exchanges = [
      createAtomicRuntimeExchange({
        label: 'first', before: first, after: 'first-after',
        exchange: (replacement) => { const displaced = first; first = replacement; return displaced; }
      }),
      createAtomicRuntimeExchange({
        label: 'second', before: second, after: 'second-after',
        exchange: (replacement) => { const displaced = second; second = replacement; return displaced; }
      })
    ];

    applyAtomicRuntimeState(exchanges, 'after');
    expect([first, second]).toEqual(['first-after', 'second-after']);
    applyAtomicRuntimeState(exchanges, 'before');
    expect([first, second]).toEqual(['first-before', 'second-before']);
    applyAtomicRuntimeState(exchanges, 'after');
    expect([first, second]).toEqual(['first-after', 'second-after']);
  });

  it('restores earlier resources when a later resource changed externally', () => {
    let first = 'first-before';
    let second = 'external-state';
    const exchanges = [
      createAtomicRuntimeExchange({
        label: 'first', before: 'first-before', after: 'first-after',
        exchange: (replacement) => { const displaced = first; first = replacement; return displaced; }
      }),
      createAtomicRuntimeExchange({
        label: 'second', before: 'second-before', after: 'second-after',
        exchange: (replacement) => { const displaced = second; second = replacement; return displaced; }
      })
    ];

    expect(() => applyAtomicRuntimeState(exchanges, 'after')).toThrow(
      'second changed outside the owned runtime transaction.'
    );
    expect([first, second]).toEqual(['first-before', 'external-state']);
    expect(exchanges.map(({ current }) => current)).toEqual(['before', 'before']);
  });
});
