export interface InputAnimationFrameHost {
  request(callback: FrameRequestCallback): number;
  cancel(handle: number): void;
}

const browserAnimationFrameHost = (): InputAnimationFrameHost => ({
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle)
});

/**
 * Publishes only the newest value produced before the next display frame.
 *
 * Pointer devices can emit substantially faster than a display refresh. This
 * scheduler keeps those raw events out of React/document state while retaining
 * the final value for a synchronous gesture-end flush.
 */
export class LatestFrameValueScheduler<Value> {
  private frameHandle: number | null = null;
  private pendingValue: Value | undefined;
  private hasPendingValue = false;
  private disposed = false;

  constructor(
    private readonly publish: (value: Value) => void,
    private readonly frameHost: InputAnimationFrameHost = browserAnimationFrameHost()
  ) {}

  schedule(value: Value): void {
    if (this.disposed) return;
    this.pendingValue = value;
    this.hasPendingValue = true;
    if (this.frameHandle !== null) return;
    this.frameHandle = this.frameHost.request(() => {
      this.frameHandle = null;
      this.publishPending();
    });
  }

  flush(): boolean {
    if (this.disposed || !this.hasPendingValue) return false;
    this.cancelFrame();
    this.publishPending();
    return true;
  }

  cancel(): boolean {
    const hadPendingValue = this.hasPendingValue;
    this.cancelFrame();
    this.pendingValue = undefined;
    this.hasPendingValue = false;
    return hadPendingValue;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
  }

  private publishPending(): void {
    if (!this.hasPendingValue) return;
    const value = this.pendingValue as Value;
    this.pendingValue = undefined;
    this.hasPendingValue = false;
    this.publish(value);
  }

  private cancelFrame(): void {
    if (this.frameHandle === null) return;
    this.frameHost.cancel(this.frameHandle);
    this.frameHandle = null;
  }
}
