import type { PaintGestureUpdate } from '../../../editor/tools/paint/paintGestureController';

export interface PaintDabScheduler {
  schedule(update: PaintGestureUpdate): void;
  flush(): void;
  cancel(): void;
}

export interface PaintFramePort {
  request(callback: () => void): number;
  cancel(handle: number): void;
}

/**
 * Retains every input dab while limiting GPU brush submissions to one batch
 * per presentation frame. Unlike a latest-value preview scheduler, paint may
 * never discard intermediate samples: doing so would create gaps in a stroke.
 */
export const createPaintDabScheduler = (
  frame: PaintFramePort,
  deliver: (update: PaintGestureUpdate) => void
): PaintDabScheduler => {
  let handle: number | null = null;
  let pending: PaintGestureUpdate | null = null;

  const run = () => {
    handle = null;
    const update = pending;
    pending = null;
    if (update?.dabs.length) deliver(update);
  };

  return {
    schedule: (update) => {
      if (!update.dabs.length) return;
      pending = pending
        ? { target: pending.target, dabs: [...pending.dabs, ...update.dabs] }
        : { target: update.target, dabs: [...update.dabs] };
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

export const createImmediatePaintDabScheduler = (
  deliver: (update: PaintGestureUpdate) => void
): PaintDabScheduler => ({
  schedule: deliver,
  flush: () => undefined,
  cancel: () => undefined
});
