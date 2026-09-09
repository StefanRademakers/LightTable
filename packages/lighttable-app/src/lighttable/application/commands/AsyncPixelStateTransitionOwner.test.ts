import { describe, expect, it, vi } from 'vitest';
import { AsyncPixelStateTransitionOwner } from './AsyncPixelStateTransitionOwner';

describe('AsyncPixelStateTransitionOwner', () => {
  it('compensates a failed state publication back to the exact source side', async () => {
    let pixels: 'source' | 'target' = 'source';
    let state: 'source' | 'target' = 'source';
    const owner = new AsyncPixelStateTransitionOwner();
    const result = await owner.transition({
      identity: {},
      applyTarget: () => { pixels = 'target'; return true; },
      applySource: () => { pixels = 'source'; return true; },
      restoreSource: async () => { state = 'source'; },
      restoreTarget: async () => { throw new Error('target failed'); }
    });
    expect(result).toMatchObject({ ok: false, compensationFailed: false });
    expect({ pixels, state, blocked: owner.blocked })
      .toEqual({ pixels: 'source', state: 'source', blocked: false });
  });

  it('retains a failed inverse pixel swap and completes on the next retry', async () => {
    let pixels: 'source' | 'target' = 'source';
    let state: 'source' | 'target' = 'source';
    let rejectTarget = true;
    let rejectCompensation = true;
    const identity = {};
    const owner = new AsyncPixelStateTransitionOwner();
    const input = {
      identity,
      applyTarget: vi.fn(() => { pixels = 'target'; return true; }),
      applySource: vi.fn(() => {
        if (rejectCompensation) return false;
        pixels = 'source';
        return true;
      }),
      restoreSource: async () => { state = 'source'; },
      restoreTarget: async () => {
        if (rejectTarget) throw new Error('target failed');
        state = 'target';
      }
    };
    expect(await owner.transition(input)).toMatchObject({ ok: false, compensationFailed: true });
    expect({ pixels, state, blocked: owner.blocked })
      .toEqual({ pixels: 'target', state: 'source', blocked: true });

    rejectCompensation = false;
    rejectTarget = false;
    expect(await owner.transition(input)).toEqual({ ok: true, compensationFailed: false });
    expect({ pixels, state, blocked: owner.blocked })
      .toEqual({ pixels: 'target', state: 'target', blocked: false });
  });
});
