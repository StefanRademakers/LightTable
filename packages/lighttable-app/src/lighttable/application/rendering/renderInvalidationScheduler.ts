export interface AnimationFrameHost {
  request(callback: FrameRequestCallback): number;
  cancel(handle: number): void;
}

const browserAnimationFrameHost = (): AnimationFrameHost => ({
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle)
});

/**
 * Coalesces renderer invalidations into one animation-frame callback.
 *
 * Dirty-stage ownership stays with the renderer. This class only owns when a
 * pending frame may execute, including synchronous export/readback flushes and
 * terminal disposal. Keeping that lifecycle outside React prevents a document
 * tab switch or late callback from rendering into a disposed context.
 */
export class RenderInvalidationScheduler {
  private frameHandle: number | null = null;
  private invalidated = false;
  private paused = false;
  private disposed = false;

  constructor(
    private readonly render: () => void,
    private readonly frameHost: AnimationFrameHost = browserAnimationFrameHost()
  ) {}

  get hasPendingFrame(): boolean {
    return this.frameHandle !== null;
  }

  get hasPendingInvalidation(): boolean {
    return this.invalidated;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  invalidate(): boolean {
    if (this.disposed) return false;
    const newlyInvalidated = !this.invalidated;
    this.invalidated = true;
    this.schedule();
    return newlyInvalidated;
  }

  /**
   * Suspends browser-frame submission without discarding dirty renderer state.
   *
   * Inactive documents keep their resident GPU resources for instant tab
   * switching. Any invalidation raised while suspended is rendered once after
   * resume instead of consuming GPU time in the background.
   */
  setPaused(paused: boolean): void {
    if (this.disposed || paused === this.paused) return;
    this.paused = paused;
    if (paused) {
      this.cancelFrame();
    } else {
      this.schedule();
    }
  }

  private schedule(): void {
    if (
      this.disposed
      || this.paused
      || !this.invalidated
      || this.frameHandle !== null
    ) return;
    this.frameHandle = this.frameHost.request(() => {
      this.frameHandle = null;
      if (this.disposed || this.paused || !this.invalidated) return;
      this.invalidated = false;
      this.render();
    });
  }

  /**
   * Cancels a queued frame and renders immediately. Export and GPU readback use
   * this to observe the latest document state without submitting the same
   * invalidation again on the next browser frame.
   */
  flush(): boolean {
    if (this.disposed) return false;
    this.cancelFrame();
    this.invalidated = false;
    this.render();
    return true;
  }

  cancelPending(): boolean {
    const hadPendingWork = this.invalidated || this.frameHandle !== null;
    this.invalidated = false;
    this.cancelFrame();
    return hadPendingWork;
  }

  private cancelFrame(): boolean {
    if (this.frameHandle === null) return false;
    this.frameHost.cancel(this.frameHandle);
    this.frameHandle = null;
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelPending();
  }
}
