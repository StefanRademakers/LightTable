/**
 * Keeps only the newest pointer-rate presentation update for the next frame.
 * Input devices can publish far more samples than the display can present;
 * queueing every sample creates latency without producing additional pixels.
 */
export class LatestFrameScheduler {
  private frame: number | null = null;
  private pending: (() => void) | null = null;

  constructor(
    private readonly requestFrame: (callback: FrameRequestCallback) => number,
    private readonly cancelFrame: (frame: number) => void
  ) {}

  schedule(task: () => void) {
    this.pending = task;
    if (this.frame !== null) return;
    this.frame = this.requestFrame(() => {
      this.frame = null;
      const pending = this.pending;
      this.pending = null;
      pending?.();
    });
  }

  flush() {
    if (this.frame !== null) this.cancelFrame(this.frame);
    this.frame = null;
    const pending = this.pending;
    this.pending = null;
    pending?.();
  }

  cancel() {
    if (this.frame !== null) this.cancelFrame(this.frame);
    this.frame = null;
    this.pending = null;
  }
}
