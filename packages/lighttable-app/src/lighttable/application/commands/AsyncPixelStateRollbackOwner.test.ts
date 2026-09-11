import { describe, expect, it, vi } from 'vitest';
import { AsyncPixelStateRollbackOwner } from './AsyncPixelStateRollbackOwner';

describe('AsyncPixelStateRollbackOwner', () => {
  it('destroys recovery state only after pixels and canonical state both roll back', async () => {
    let applied = true;
    let side: 'before' | 'after' = 'after';
    const destroy = vi.fn();
    const owner = new AsyncPixelStateRollbackOwner();

    expect(await owner.rollback({
      edit: { byteSize: 8, undo: () => true, redo: () => true, destroy },
      applyPixel: (direction) => {
        if (applied !== (direction === 'undo')) return false;
        applied = direction === 'redo';
        return true;
      },
      restoreBefore: async (publish) => { publish(); side = 'before'; },
      restoreAfter: async (publish) => { publish(); side = 'after'; }
    })).toEqual({ ok: true, compensationFailed: false });
    expect({ applied, side }).toEqual({ applied: false, side: 'before' });
    expect(destroy).toHaveBeenCalledOnce();
    expect(owner.blocked).toBe(false);
  });

  it('compensates a failed state rollback and retries without double undo', async () => {
    let applied = true;
    let side: 'before' | 'after' = 'after';
    let rejectBefore = true;
    const destroy = vi.fn();
    const directions: string[] = [];
    const owner = new AsyncPixelStateRollbackOwner();
    const input = {
      edit: { byteSize: 8, undo: () => true, redo: () => true, destroy },
      applyPixel: (direction: 'undo' | 'redo') => {
        directions.push(direction);
        if (applied !== (direction === 'undo')) return false;
        applied = direction === 'redo';
        return true;
      },
      restoreBefore: async (publish: () => void) => {
        publish();
        if (rejectBefore) throw new Error('publication failed');
        side = 'before';
      },
      restoreAfter: async (publish: () => void) => { publish(); side = 'after'; }
    };

    expect(await owner.rollback(input)).toEqual({ ok: false, compensationFailed: false });
    expect({ applied, side, blocked: owner.blocked }).toEqual({
      applied: true, side: 'after', blocked: true
    });
    rejectBefore = false;
    expect(await owner.retry()).toEqual({ ok: true, compensationFailed: false });
    expect(directions).toEqual(['undo', 'redo', 'undo']);
    expect({ applied, side, blocked: owner.blocked }).toEqual({
      applied: false, side: 'before', blocked: false
    });
    expect(destroy).toHaveBeenCalledOnce();
  });
});
