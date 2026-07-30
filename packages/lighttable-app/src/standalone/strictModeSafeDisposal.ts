export type DeferredWorkScheduler = (work: () => void) => void;

/**
 * Defers terminal resource disposal by one microtask.
 *
 * React development Strict Mode intentionally performs setup -> cleanup ->
 * setup for effects. A reconnect invalidates the pending cleanup, while a real
 * unmount reaches the microtask without a replacement setup and disposes once.
 */
export class StrictModeSafeDisposal {
  private generation = 0;
  private disposed = false;
  private readonly disposeResource: () => void;
  private readonly schedule: DeferredWorkScheduler;

  constructor(
    disposeResource: () => void,
    schedule: DeferredWorkScheduler = (work) => queueMicrotask(work)
  ) {
    this.disposeResource = disposeResource;
    this.schedule = schedule;
  }

  connect(): () => void {
    if (this.disposed) {
      throw new Error('Cannot reconnect a disposed resource.');
    }
    this.generation += 1;
    return () => {
      const cleanupGeneration = ++this.generation;
      // Invoke the scheduler as a plain function. Browser host functions such
      // as `queueMicrotask` may reject an accidental class-instance `this`.
      const schedule = this.schedule;
      schedule(() => {
        if (
          !this.disposed
          && cleanupGeneration === this.generation
        ) {
          this.disposed = true;
          this.disposeResource();
        }
      });
    };
  }
}
