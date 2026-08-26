import { describe, expect, it } from 'vitest';
import { measureVideoPlaybackTelemetry } from './videoPlaybackTelemetry';

describe('measureVideoPlaybackTelemetry', () => {
  it('reports target cadence without a warning when all frames are presented', () => {
    expect(measureVideoPlaybackTelemetry({
      baseline: { sampledAtMilliseconds: 1000, totalFrames: 300, droppedFrames: 2 },
      current: { sampledAtMilliseconds: 2000, totalFrames: 330, droppedFrames: 2 },
      expectedFramesPerSecond: 30
    })).toEqual({
      status: 'measured',
      actualFramesPerSecond: 30,
      targetFramesPerSecond: 30,
      droppedFrames: 0,
      belowTarget: false
    });
  });

  it('reports dropped presentation frames below an explicit target', () => {
    expect(measureVideoPlaybackTelemetry({
      baseline: { sampledAtMilliseconds: 0, totalFrames: 0, droppedFrames: 0 },
      current: { sampledAtMilliseconds: 1000, totalFrames: 30, droppedFrames: 4 },
      expectedFramesPerSecond: 30
    })).toMatchObject({
      actualFramesPerSecond: 26,
      targetFramesPerSecond: 30,
      droppedFrames: 4,
      belowTarget: true
    });
  });

  it('uses attempted cadence when source metadata has no frame rate', () => {
    expect(measureVideoPlaybackTelemetry({
      baseline: { sampledAtMilliseconds: 0, totalFrames: 100, droppedFrames: 0 },
      current: { sampledAtMilliseconds: 1000, totalFrames: 125, droppedFrames: 1 }
    })).toMatchObject({
      actualFramesPerSecond: 24,
      targetFramesPerSecond: 25,
      belowTarget: true
    });
  });
});
