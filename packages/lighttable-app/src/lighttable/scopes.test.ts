import { describe, expect, it } from 'vitest';
import {
  displayRgbToBt709CbCr,
  rgbParadeBin,
  resolveScopeSampleGrid,
  skinToneReferenceEnd,
  vectorscopePosition,
  vectorscopeTargetPositions
} from './scopes';

describe('LightTable scope math', () => {
  it('places every neutral display value exactly at vectorscope centre', () => {
    for (const value of [0, 0.18, 0.5, 1]) {
      expect(vectorscopePosition(value, value, value)).toEqual({ x: 0.5, y: 0.5 });
    }
  });

  it('uses the documented BT.709 matrix on display-encoded RGB', () => {
    const red = displayRgbToBt709CbCr(1, 0, 0);
    expect(red.y).toBeCloseTo(0.2126, 6);
    expect(red.cb).toBeCloseTo(-0.114572, 5);
    expect(red.cr).toBeCloseTo(0.5, 5);
  });

  it('keeps the six 75 percent targets in their expected directions', () => {
    const targets = Object.fromEntries(vectorscopeTargetPositions().map((target) => [target.label, target]));
    expect(targets.R.x).toBeLessThan(0.5);
    expect(targets.R.y).toBeLessThan(0.5);
    expect(targets.B.x).toBeGreaterThan(0.5);
    expect(targets.B.y).toBeGreaterThan(0.5);
    expect(targets.G.x).toBeLessThan(0.5);
    expect(targets.G.y).toBeGreaterThan(0.5);
  });

  it('points the skin reference between yellow and red toward 10 to 11 o clock', () => {
    const end = skinToneReferenceEnd();
    expect(end.x).toBeLessThan(0.5);
    expect(end.y).toBeLessThan(0.5);
  });

  it('samples the whole image with an aspect-preserving quality budget', () => {
    const low = resolveScopeSampleGrid(4096, 2048, 'low', false);
    const high = resolveScopeSampleGrid(4096, 2048, 'high', false);
    expect(low.width / low.height).toBeCloseTo(2, 2);
    expect(low.width * low.height).toBeLessThanOrEqual(256 * 256 * 1.01);
    expect(high.width * high.height).toBeGreaterThan(low.width * low.height);
  });

  it('keeps horizontal source position and vertical code value in the RGB Parade', () => {
    expect(rgbParadeBin(0, 0, 0)).toMatchObject({ x: 0, y: 0 });
    expect(rgbParadeBin(1, 1, 0)).toMatchObject({ x: 255, y: 255 });
    expect(rgbParadeBin(0.5, 0.5, 1).index).toBeGreaterThanOrEqual(256 * 256);
    expect(rgbParadeBin(0.5, 0.5, 1).index).toBeLessThan(2 * 256 * 256);
  });
});
