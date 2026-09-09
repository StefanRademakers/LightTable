export interface AsyncPixelStateTransition {
  readonly identity: object;
  applyTarget(): boolean;
  applySource(): boolean;
  restoreSource(): Promise<void>;
  restoreTarget(): Promise<void>;
}

export interface AsyncPixelStateTransitionResult {
  readonly ok: boolean;
  readonly compensationFailed: boolean;
  readonly reason?: unknown;
}

interface PendingTransition {
  readonly input: AsyncPixelStateTransition;
  pixelSide: 'source' | 'target';
}

/** Retains enough state to retry an undo/redo transition after failed compensation. */
export class AsyncPixelStateTransitionOwner {
  private pending: PendingTransition | null = null;

  get blocked() { return this.pending !== null; }

  async transition(input: AsyncPixelStateTransition): Promise<AsyncPixelStateTransitionResult> {
    if (this.pending && this.pending.input.identity !== input.identity) {
      return { ok: false, compensationFailed: true,
        reason: new Error('Another pixel-state transition still requires recovery.') };
    }
    this.pending ??= { input, pixelSide: 'source' };
    const pending = this.pending;
    try {
      if (pending.pixelSide === 'target') {
        if (!pending.input.applySource()) {
          return { ok: false, compensationFailed: true,
            reason: new Error('The pixel-state compensation could not be retried.') };
        }
        pending.pixelSide = 'source';
        await pending.input.restoreSource();
      }
      if (!pending.input.applyTarget()) {
        this.pending = null;
        return { ok: false, compensationFailed: false,
          reason: new Error('The target pixel state is unavailable.') };
      }
      pending.pixelSide = 'target';
      await pending.input.restoreTarget();
      this.pending = null;
      return { ok: true, compensationFailed: false };
    } catch (reason) {
      let compensationFailed = false;
      if (pending.pixelSide === 'target') {
        if (pending.input.applySource()) pending.pixelSide = 'source';
        else compensationFailed = true;
      }
      try {
        await pending.input.restoreSource();
      } catch {
        compensationFailed = true;
      }
      if (!compensationFailed) this.pending = null;
      return { ok: false, compensationFailed, reason };
    }
  }
}
