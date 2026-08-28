import { describe, expect, it } from 'vitest';
import { halfFloatToNormalizedU16, normalizedU16ToHalfFloat } from './halfFloatPixels';

describe('half-float display export conversion', () => {
  it('maps endpoints, midpoint, negative and overflow values safely', () => {
    expect([...halfFloatToNormalizedU16(Uint16Array.from([
      0x0000, // 0
      0x3800, // 0.5
      0x3c00, // 1
      0xbc00, // -1
      0x4000, // 2
      0x7c00, // +infinity
      0x7e00 // NaN
    ]))]).toEqual([0, 32768, 65535, 0, 65535, 65535, 0]);
  });

  it('prepares normalized 16-bit source samples for direct rgba16float upload', () => {
    const source = Uint16Array.from([0, 1, 32768, 65534, 65535]);
    const half = normalizedU16ToHalfFloat(source);

    expect([...half]).toEqual([0x0000, 0x0100, 0x3800, 0x3c00, 0x3c00]);
    const roundTrip = halfFloatToNormalizedU16(half);
    expect(roundTrip[0]).toBe(0);
    expect(Math.abs(roundTrip[1]! - source[1]!)).toBeLessThanOrEqual(1);
    expect(Math.abs(roundTrip[2]! - source[2]!)).toBeLessThanOrEqual(16);
    expect(roundTrip[4]).toBe(65535);
  });
});
