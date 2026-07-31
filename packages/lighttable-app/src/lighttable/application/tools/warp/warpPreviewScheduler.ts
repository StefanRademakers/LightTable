export interface WarpPreviewScheduler {
  schedule(task: () => void): void;
  flush(): void;
  cancel(): void;
}

export interface WarpPreviewFramePort {
  request(callback: () => void): number;
  cancel(handle: number): void;
}

/**
 * Coalesces expensive immutable document projections without dropping input.
 *
 * The gesture controller remains authoritative for every pointer sample. Only
 * the latest derived preview task is retained until the next presentation
 * frame, and commit can synchronously flush it before recording history.
 */
export const createWarpPreviewScheduler = (
  frame: WarpPreviewFramePort
): WarpPreviewScheduler => {
  let handle: number | null = null;
  let pending: (() => void) | null = null;

  const run = () => {
    handle = null;
    const task = pending;
    pending = null;
    task?.();
  };

  return {
    schedule: (task) => {
      pending = task;
      if (handle === null) handle = frame.request(run);
    },
    flush: () => {
      if (!pending) return;
      if (handle !== null) frame.cancel(handle);
      run();
    },
    cancel: () => {
      if (handle !== null) frame.cancel(handle);
      handle = null;
      pending = null;
    }
  };
};

export const createImmediateWarpPreviewScheduler = (): WarpPreviewScheduler => ({
  schedule: (task) => task(),
  flush: () => undefined,
  cancel: () => undefined
});
