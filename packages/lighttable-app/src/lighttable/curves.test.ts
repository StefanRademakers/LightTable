import { describe, expect, it } from 'vitest';
import { buildCurveLut, createDefaultCurves, curveActiveMask, evaluateToneCurve } from './curves';

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

  it('marks only the changed LUT channels as active', () => {
    const curves = createDefaultCurves();
    expect(curveActiveMask(curves)).toBe(0);
    curves.red[0].y = 0.1;
    expect(curveActiveMask(curves)).toBe(2);
    curves.master[1].y = 0.9;
    expect(curveActiveMask(curves)).toBe(3);
  });
});
