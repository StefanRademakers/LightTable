import { describe, expect, it } from 'vitest';
import {
  calculateSignedCircleOfConfusion,
  createDefaultLensBlurSettings,
  focusInterval,
  lensBlurQualitySampleCount,
  lensBlurIsActive
} from './settings';

describe('Lens Blur settings', () => {
  it('is opt-in and bypasses when aperture size is zero', () => {
    const settings = createDefaultLensBlurSettings();
    expect(lensBlurIsActive(settings)).toBe(false);
    settings.enabled = true;
    expect(lensBlurIsActive(settings)).toBe(true);
    settings.apertureSize = 0;
    expect(lensBlurIsActive(settings)).toBe(false);
  });

  it('keeps the depth of field interval sharp and signs blur consistently', () => {
    const settings = createDefaultLensBlurSettings();
    expect(calculateSignedCircleOfConfusion(0.5, settings)).toBe(0);
    expect(calculateSignedCircleOfConfusion(0.9, settings)).toBeGreaterThan(0);
    expect(calculateSignedCircleOfConfusion(0.1, settings)).toBeLessThan(0);
  });

  it('derives a symmetric sharp interval from focus distance and depth of field', () => {
    const settings = createDefaultLensBlurSettings();
    settings.focusDistance = 0.6;
    settings.depthOfField = 0.2;
    expect(focusInterval(settings)).toEqual({ start: 0.5, end: 0.7 });
  });

  it('uses transition feather only after the sharp interval', () => {
    const settings = createDefaultLensBlurSettings();
    settings.depthOfField = 0.2;
    settings.transitionFeather = 0.1;
    expect(calculateSignedCircleOfConfusion(0.6, settings)).toBe(0);
    expect(calculateSignedCircleOfConfusion(0.7, settings)).toBeCloseTo(1);
  });

  it('defaults to the 64-sample final gather and exposes testable quality tiers', () => {
    const settings = createDefaultLensBlurSettings();
    expect(settings.quality).toBe('high');
    expect(settings.transitionFeather).toBe(0.4);
    expect(lensBlurQualitySampleCount('balanced')).toBe(48);
    expect(lensBlurQualitySampleCount('high')).toBe(64);
    expect(lensBlurQualitySampleCount('ultra')).toBe(128);
  });
});
