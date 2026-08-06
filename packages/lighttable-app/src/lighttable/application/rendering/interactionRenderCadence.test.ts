import { describe, expect, it } from 'vitest';
import {
  interactionFrameIntervalMs,
  warpInteractionFrameIntervalMs
} from './interactionRenderCadence';

describe('warp interaction render cadence', () => {
  it('keeps ordinary documents at presentation cadence', () => {
    expect(warpInteractionFrameIntervalMs(2_000, 2_000)).toBe(0);
  });

  it('bounds increasingly expensive large-canvas submissions', () => {
    expect(warpInteractionFrameIntervalMs(2_500, 2_500)).toBe(100);
    expect(warpInteractionFrameIntervalMs(3_000, 3_000)).toBe(500);
  });

  it('keeps the strictest active effect or Warp cadence', () => {
    expect(interactionFrameIntervalMs(30, false, { width: 3_000, height: 3_000 })).toBe(30);
    expect(interactionFrameIntervalMs(30, true, { width: 3_000, height: 3_000 })).toBe(500);
    expect(interactionFrameIntervalMs(30, true, null)).toBe(30);
  });
});
