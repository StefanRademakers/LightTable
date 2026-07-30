import { describe, expect, it } from 'vitest';
import {
  colorGradingEndpointGuard,
  colorGradingMasks,
  colorGradingTonalPosition
} from './colorGrading';

describe('LightTable Color Grading masks', () => {
  it('places linear middle grey near the centre of the perceptual range', () => {
    expect(colorGradingTonalPosition(0.18)).toBeCloseTo(0.495, 2);
    expect(colorGradingTonalPosition(0)).toBe(0);
    expect(colorGradingTonalPosition(4)).toBe(1);
  });

  it('forms a partition of unity for every Blending and Balance value', () => {
    for (const blending of [0, 25, 50, 75, 100]) {
      for (const balance of [-100, -35, 0, 40, 100]) {
        for (let step = 0; step <= 100; step += 1) {
          const masks = colorGradingMasks(step / 100, blending, balance);
          expect(masks[0] + masks[1] + masks[2]).toBeCloseTo(1, 10);
          masks.forEach((weight) => {
            expect(weight).toBeGreaterThanOrEqual(0);
            expect(weight).toBeLessThanOrEqual(1);
          });
        }
      }
    }
  });

  it('moves emphasis toward highlights for positive Balance', () => {
    const neutral = colorGradingMasks(0.5, 50, 0);
    const highlightBiased = colorGradingMasks(0.5, 50, 70);
    expect(highlightBiased[2]).toBeGreaterThan(neutral[2]);
    expect(highlightBiased[0]).toBeLessThan(neutral[0]);
  });

  it('keeps absolute black and display white neutral with soft interior ramps', () => {
    expect(colorGradingEndpointGuard(0)).toBe(0);
    expect(colorGradingEndpointGuard(1)).toBe(0);
    expect(colorGradingEndpointGuard(0.5)).toBe(1);
    expect(colorGradingEndpointGuard(0.02)).toBeGreaterThan(0);
    expect(colorGradingEndpointGuard(0.02)).toBeLessThan(1);
    expect(colorGradingEndpointGuard(0.97)).toBeGreaterThan(0);
    expect(colorGradingEndpointGuard(0.97)).toBeLessThan(1);
  });
});
