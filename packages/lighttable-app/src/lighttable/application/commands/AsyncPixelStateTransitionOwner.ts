export interface AsyncPixelStateTransition {
  readonly identity: object;
  applyTarget(): boolean;
  applySource(): boolean;
  restoreSource(publishPixels: () => () => void): Promise<void>;
  restoreTarget(publishPixels: () => () => void): Promise<void>;
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
    const publishSource = () => {
      if (pending.pixelSide === 'source') return () => undefined;
      if (!pending.input.applySource()) throw new Error('The pixel-state compensation could not be retried.');
      pending.pixelSide = 'source';
      return () => {
        if (!pending.input.applyTarget()) throw new Error('The source pixel publication could not be reverted.');
        pending.pixelSide = 'target';
      };
    };
    try {
      if (pending.pixelSide === 'target') {
        await pending.input.restoreSource(publishSource);
      }
      await pending.input.restoreTarget(() => {
        if (!pending.input.applyTarget()) throw new Error('The target pixel state is unavailable.');
        pending.pixelSide = 'target';
        return publishSource;
      });
      this.pending = null;
      return { ok: true, compensationFailed: false };
    } catch (reason) {
      let compensationFailed = false;
      try {
        await pending.input.restoreSource(publishSource);
      } catch {
        compensationFailed = true;
      }
      if (!compensationFailed) this.pending = null;
      return { ok: false, compensationFailed, reason };
    }
  }
}
