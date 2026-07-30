import { describe, expect, it } from 'vitest';
import {
  COLOR_MIXER_CENTERS,
  evaluateColorMixerCurve,
  type ColorMixerValues
} from './colorMixer';

describe('LightTable Color Mixer curve', () => {
  it('interpolates every slider exactly at its perceptual range centre', () => {
    COLOR_MIXER_CENTERS.forEach((center, activeIndex) => {
      const values = COLOR_MIXER_CENTERS.map((_, index) => index === activeIndex ? 100 : 0) as ColorMixerValues;
      expect(evaluateColorMixerCurve(center, values)).toBe(100);
    });
  });

  it('keeps a global adjustment constant around the complete hue circle', () => {
    const values: ColorMixerValues = [-63, -63, -63, -63, -63, -63, -63, -63];
    for (let step = 0; step < 360; step += 1) {
      expect(evaluateColorMixerCurve((step / 180) * Math.PI, values)).toBeCloseTo(-63, 10);
    }
  });

  it('never overshoots the supplied slider range', () => {
    const values: ColorMixerValues = [-100, 80, -15, 30, 100, -40, 5, 65];
    for (let step = 0; step < 1440; step += 1) {
      const result = evaluateColorMixerCurve((step / 720) * Math.PI - Math.PI, values);
      expect(result).toBeGreaterThanOrEqual(-100);
      expect(result).toBeLessThanOrEqual(100);
    }
  });

  it('wraps continuously between Magenta and Red', () => {
    const values: ColorMixerValues = [100, 20, -15, 30, 5, -40, 45, -80];
    const epsilon = 1e-6;
    expect(evaluateColorMixerCurve(-Math.PI + epsilon, values))
      .toBeCloseTo(evaluateColorMixerCurve(Math.PI - epsilon, values), 4);
  });
});
