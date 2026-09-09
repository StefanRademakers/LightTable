import type { ReversiblePixelEdit } from '../../editor/history/ReversiblePixelEdit';

export interface AsyncPixelStateRollback {
  readonly edit: ReversiblePixelEdit;
  readonly applyPixel: (direction: 'undo' | 'redo') => boolean;
  readonly restoreBefore: () => Promise<void>;
  readonly restoreAfter: () => Promise<void>;
}

export interface AsyncPixelStateRollbackOutcome {
  readonly ok: boolean;
  readonly compensationFailed: boolean;
}

/**
 * Retains an unpublished compound pixel/state mutation until both surfaces can
 * be returned to their opening state. A failed rollback is first compensated
 * to the known applied side; its sole GPU snapshot is never destroyed.
 */
export class AsyncPixelStateRollbackOwner {
  private pending: (AsyncPixelStateRollback & { applied: boolean }) | null = null;

  get blocked() { return this.pending !== null; }

  async rollback(input: AsyncPixelStateRollback): Promise<AsyncPixelStateRollbackOutcome> {
    if (this.pending) return { ok: false, compensationFailed: true };
    this.pending = { ...input, applied: true };
    return this.retry() as Promise<AsyncPixelStateRollbackOutcome>;
  }

  async retry(): Promise<AsyncPixelStateRollbackOutcome | null> {
    const pending = this.pending;
    if (!pending) return null;
    const applySafely = (direction: 'undo' | 'redo') => {
      try {
        const applied = pending.applyPixel(direction);
        if (applied) pending.applied = direction === 'redo';
        return applied;
      } catch {
        return false;
      }
    };
    const restoreSafely = async (side: 'before' | 'after') => {
      try {
        await (side === 'before' ? pending.restoreBefore() : pending.restoreAfter());
        return true;
      } catch {
        return false;
      }
    };

    // A prior compensation may have stopped between the pixel and canonical
    // state surfaces. Re-establish the fully-applied side before retrying.
    if (!pending.applied && !applySafely('redo')) {
      return { ok: false, compensationFailed: true };
    }
    if (!await restoreSafely('after')) {
      return { ok: false, compensationFailed: true };
    }
    if (!applySafely('undo')) {
      return { ok: false, compensationFailed: false };
    }
    if (!await restoreSafely('before')) {
      const pixelsRestored = applySafely('redo');
      const stateRestored = pixelsRestored && await restoreSafely('after');
      return { ok: false, compensationFailed: !pixelsRestored || !stateRestored };
    }

    pending.edit.destroy();
    this.pending = null;
    return { ok: true, compensationFailed: false };
  }
}
