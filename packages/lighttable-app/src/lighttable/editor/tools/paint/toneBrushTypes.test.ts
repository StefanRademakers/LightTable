import { describe, expect, it } from 'vitest';
import { calibratedToneExposure } from './toneBrushTypes';

describe('calibratedToneExposure', () => {
  it('keeps low exposures literal for gradual buildup', () => {
    expect(calibratedToneExposure('dodge', 0.05, true)).toBeCloseTo(0.05 * 0.35);
    expect(calibratedToneExposure('burn', 0.2, false)).toBeCloseTo(0.2 * 0.7);
  });

  it('matches the measured high-exposure compression per operator', () => {
    expect(calibratedToneExposure('dodge', 0.5, true)).toBeCloseTo(0.4 * 0.35);
    expect(calibratedToneExposure('burn', 0.5, false)).toBeCloseTo(0.5 * 0.7);
  });

  it('bounds malformed session values', () => {
    expect(calibratedToneExposure('dodge', -1, true)).toBe(0);
    expect(calibratedToneExposure('burn', 2, true)).toBe(0.35);
  });
});
