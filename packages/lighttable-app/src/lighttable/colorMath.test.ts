import { describe, expect, it } from 'vitest';
import {
  applyExposure,
  applyDisplayShoulder,
  isFiniteRgb,
  linearRgbToOklab,
  linearToSrgb,
  oklabToLinearRgb,
  srgbToLinear
} from './colorMath';

const expectRgbClose = (actual: readonly number[], expected: readonly number[], precision = 6) => {
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index], precision));
};

describe('LightTable color math', () => {
  it('roundtrips sRGB through linear light', () => {
    const input = [0.02, 0.5, 0.95] as const;
    expectRgbClose(linearToSrgb(srgbToLinear(input)), input);
  });

  it('roundtrips linear RGB through OKLab', () => {
    const input = [0.08, 0.42, 0.91] as const;
    expectRgbClose(oklabToLinearRgb(linearRgbToOklab(input)), input, 5);
  });

  it('uses photographic EV stops and preserves zero identity', () => {
    const input = [0.125, 0.25, 0.5] as const;
    expectRgbClose(applyExposure(input, 0), input);
    expectRgbClose(applyExposure(input, 1), [0.25, 0.5, 1]);
    expectRgbClose(applyExposure(input, -1), [0.0625, 0.125, 0.25]);
  });

  it('stays finite for black, white, and near-zero values', () => {
    for (const input of [[0, 0, 0], [1, 1, 1], [1e-12, 1e-9, 1e-6]] as const) {
      expect(isFiniteRgb(oklabToLinearRgb(linearRgbToOklab(input)))).toBe(true);
    }
  });

  it('keeps the shoulder an exact identity when no luminance control requests it', () => {
    for (const value of [0, 0.18, 0.72, 0.95, 1, 1.5]) {
      expect(applyDisplayShoulder(value, 0)).toBe(value);
    }
  });

  it('engages the shoulder continuously instead of switching the full curve on', () => {
    expect(applyDisplayShoulder(1, 1e-6)).toBeGreaterThan(0.9999);
    expect(applyDisplayShoulder(1, 0.01)).toBeGreaterThan(applyDisplayShoulder(1, 0.5));
    expect(applyDisplayShoulder(1, 1)).toBeCloseTo(0.86, 8);
  });

  it('keeps every fixed-strength shoulder monotonic and below display white', () => {
    for (const strength of [0.0001, 0.01, 0.1, 0.5, 1]) {
      let previous = 0;
      for (let step = 0; step <= 5000; step += 1) {
        const result = applyDisplayShoulder(step / 1000, strength);
        expect(result).toBeGreaterThanOrEqual(previous);
        expect(result).toBeLessThan(1);
        previous = result;
      }
    }
  });
});
