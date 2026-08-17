import { describe, expect, it } from 'vitest';
import {
  buildCurveLut,
  createDefaultCurves,
  curveActiveMask,
  evaluatePhotoshopToneCurve,
  evaluateToneCurve
} from './curves';

describe('LightTable Custom Curves', () => {
  it('builds an identity LUT without moving black or white', () => {
    const lut = buildCurveLut(createDefaultCurves());
    expect(lut[0]).toBe(0);
    expect(lut[(1024 - 1) * 4]).toBe(1);
    expect(lut[512 * 4]).toBeCloseTo(512 / 1023, 5);
  });

  it('moves exact endpoints', () => {
    expect(evaluateToneCurve([{ x: 0, y: 0.15 }, { x: 1, y: 1 }], 0)).toBeCloseTo(0.15);
    expect(evaluateToneCurve([{ x: 0, y: 0 }, { x: 1, y: 0.82 }], 1)).toBeCloseTo(0.82);
  });

  it('does not overshoot a monotonic control-point sequence', () => {
    const points = [{ x: 0, y: 0.08 }, { x: 0.2, y: 0.12 }, { x: 0.65, y: 0.8 }, { x: 1, y: 0.94 }];
    let previous = evaluateToneCurve(points, 0);
    for (let index = 1; index <= 1024; index += 1) {
      const value = evaluateToneCurve(points, index / 1024);
      expect(value).toBeGreaterThanOrEqual(previous - 1e-7);
      expect(value).toBeGreaterThanOrEqual(0.08);
      expect(value).toBeLessThanOrEqual(0.94);
      previous = value;
    }
  });

  it('matches Photoshop 27.11 natural-spline holdout samples', () => {
    const lifted = [{ x: 0, y: 0 }, { x: 128 / 255, y: 230 / 255 }, { x: 1, y: 1 }];
    const lowered = [{ x: 0, y: 0 }, { x: 128 / 255, y: 26 / 255 }, { x: 1, y: 1 }];
    expect(evaluatePhotoshopToneCurve(lifted, 64 / 255) * 255).toBeCloseTo(134, 0);
    expect(evaluatePhotoshopToneCurve(lifted, 192 / 255) * 255).toBeCloseTo(255, 0);
    expect(evaluatePhotoshopToneCurve(lowered, 64 / 255) * 255).toBeCloseTo(0, 0);
    expect(evaluatePhotoshopToneCurve(lowered, 192 / 255) * 255).toBeCloseTo(122, 0);
  });

  it('keeps Grade monotone interpolation separate from Photoshop Curves', () => {
    const grade = createDefaultCurves('monotone');
    const photoshop = createDefaultCurves('photoshop-natural');
    grade.master = [{ x: 0, y: 0 }, { x: 128 / 255, y: 230 / 255 }, { x: 1, y: 1 }];
    photoshop.master = grade.master;
    expect(buildCurveLut(grade)[256 * 4]).not.toBeCloseTo(buildCurveLut(photoshop)[256 * 4]!, 3);
  });

  it('marks only the changed LUT channels as active', () => {
    const curves = createDefaultCurves();
    expect(curveActiveMask(curves)).toBe(0);
    curves.red[0].y = 0.1;
    expect(curveActiveMask(curves)).toBe(2);
    curves.master[1].y = 0.9;
    expect(curveActiveMask(curves)).toBe(3);
  });
});
