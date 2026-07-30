import { describe, expect, it } from 'vitest';
import { createDefaultLensDistortionSettings, lensDistortionIsActive, mapLensDistortionUv } from './settings';

describe('Lens Distortion settings', () => {
  it('is opt-in but immediately useful when enabled', () => {
    const settings = createDefaultLensDistortionSettings();
    expect(lensDistortionIsActive(settings)).toBe(false);
    settings.enabled = true;
    expect(lensDistortionIsActive(settings)).toBe(true);
  });

  it('bypasses neutral geometry even when enabled', () => {
    const settings = createDefaultLensDistortionSettings();
    settings.enabled = true;
    settings.amount = 0;
    settings.zoom = 0;
    expect(lensDistortionIsActive(settings)).toBe(false);
  });

  it('keeps the optical centre fixed in the CPU focus-picking map', () => {
    const settings = createDefaultLensDistortionSettings();
    settings.enabled = true;
    expect(mapLensDistortionUv(0.5, 0.5, 1920, 1080, settings)).toEqual({ x: 0.5, y: 0.5 });
  });
});
