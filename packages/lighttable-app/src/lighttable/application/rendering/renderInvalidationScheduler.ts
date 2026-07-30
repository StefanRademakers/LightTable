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
  private disposed = false;

  constructor(
    private readonly render: () => void,
    private readonly frameHost: AnimationFrameHost = browserAnimationFrameHost()
  ) {}

  get hasPendingFrame(): boolean {
    return this.frameHandle !== null;
  }

  invalidate(): boolean {
    if (this.disposed || this.frameHandle !== null) return false;
    this.frameHandle = this.frameHost.request(() => {
      this.frameHandle = null;
      if (!this.disposed) this.render();
    });
    return true;
  }

  /**
   * Cancels a queued frame and renders immediately. Export and GPU readback use
   * this to observe the latest document state without submitting the same
   * invalidation again on the next browser frame.
   */
  flush(): boolean {
    if (this.disposed) return false;
    this.cancelPending();
    this.render();
    return true;
  }

  cancelPending(): boolean {
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
