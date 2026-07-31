export interface WarpHoldScheduler {
  start(task: (timeMs: number) => void): void;
  stop(): void;
}

export interface WarpHoldFramePort {
  request(callback: (timeMs: number) => void): number;
  cancel(handle: number): void;
}

/**
 * Turns display frames into a bounded, deterministic authoring cadence.
 *
 * Twirl/Pinch/Bloat are rate-based brushes: they must keep authoring while the
 * pointer is held still, but their result must not depend on a 60/120 Hz
 * display or flood immutable document previews. At most one quantum is emitted
 * per interval and missed frames never create a catch-up burst.
 */
export const createWarpHoldScheduler = (
  frame: WarpHoldFramePort,
  intervalMs = 50
): WarpHoldScheduler => {
  let handle: number | null = null;
  let task: ((timeMs: number) => void) | null = null;
  let lastEmissionMs: number | null = null;

  const requestNext = () => {
    if (task !== null) handle = frame.request(onFrame);
  };

  function onFrame(timeMs: number) {
    handle = null;
    if (!task) return;
    if (lastEmissionMs === null) {
      lastEmissionMs = timeMs;
    } else if (timeMs - lastEmissionMs >= intervalMs) {
      lastEmissionMs = timeMs;
      task(timeMs);
    }
    requestNext();
  }

  return {
    start: (nextTask) => {
      task = nextTask;
      lastEmissionMs = null;
      if (handle === null) handle = frame.request(onFrame);
    },
    stop: () => {
      task = null;
      lastEmissionMs = null;
      if (handle !== null) frame.cancel(handle);
      handle = null;
    }
  };
};

export const createInactiveWarpHoldScheduler = (): WarpHoldScheduler => ({
  start: () => undefined,
  stop: () => undefined
});
