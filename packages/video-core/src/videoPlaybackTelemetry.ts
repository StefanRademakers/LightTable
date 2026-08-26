import type { VideoPlaybackTelemetry } from './videoDocument';

export interface VideoPlaybackQualitySample {
  readonly sampledAtMilliseconds: number;
  /** Frames submitted for presentation, including frames Chromium dropped. */
  readonly totalFrames: number;
  readonly droppedFrames: number;
}

const finiteCounter = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, value) : 0;

/**
 * Converts Chromium's cumulative playback-quality counters into a real
 * presentation rate. `totalFrames - droppedFrames` is what reached the
 * presentation path; `totalFrames` is the cadence the decoder attempted.
 */
export const measureVideoPlaybackTelemetry = ({
  baseline,
  current,
  expectedFramesPerSecond
}: {
  readonly baseline: VideoPlaybackQualitySample;
  readonly current: VideoPlaybackQualitySample;
  readonly expectedFramesPerSecond?: number | null;
}): VideoPlaybackTelemetry => {
  const elapsedMilliseconds = Math.max(
    0,
    finiteCounter(current.sampledAtMilliseconds) - finiteCounter(baseline.sampledAtMilliseconds)
  );
  const totalFrames = Math.max(0, finiteCounter(current.totalFrames) - finiteCounter(baseline.totalFrames));
  const droppedFrames = Math.min(
    totalFrames,
    Math.max(0, finiteCounter(current.droppedFrames) - finiteCounter(baseline.droppedFrames))
  );
  const configuredTarget = expectedFramesPerSecond !== null
    && expectedFramesPerSecond !== undefined
    && Number.isFinite(expectedFramesPerSecond)
    && expectedFramesPerSecond > 0
      ? expectedFramesPerSecond
      : null;

  if (elapsedMilliseconds < 500 || (totalFrames === 0 && configuredTarget === null)) {
    return {
      status: 'warming',
      actualFramesPerSecond: null,
      targetFramesPerSecond: configuredTarget,
      droppedFrames,
      belowTarget: false
    };
  }

  const seconds = elapsedMilliseconds / 1000;
  const actualFramesPerSecond = (totalFrames - droppedFrames) / seconds;
  const targetFramesPerSecond = configuredTarget ?? totalFrames / seconds;
  // Ignore sub-frame timer jitter; one genuinely dropped frame in a 30 fps
  // window still crosses this threshold and is surfaced to the user.
  const tolerance = Math.max(0.5, targetFramesPerSecond * 0.02);

  return {
    status: 'measured',
    actualFramesPerSecond,
    targetFramesPerSecond,
    droppedFrames,
    belowTarget: actualFramesPerSecond < targetFramesPerSecond - tolerance
  };
};
