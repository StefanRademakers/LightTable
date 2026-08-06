import { describe, expect, it } from 'vitest';
import { warpInteractionFrameIntervalMs } from './interactionRenderCadence';

describe('warp interaction render cadence', () => {
  it('keeps ordinary documents at presentation cadence', () => {
    expect(warpInteractionFrameIntervalMs(2_000, 2_000)).toBe(0);
  });

  it('bounds increasingly expensive large-canvas submissions', () => {
    expect(warpInteractionFrameIntervalMs(2_500, 2_500)).toBe(100);
    expect(warpInteractionFrameIntervalMs(3_000, 3_000)).toBe(500);
  });
});
