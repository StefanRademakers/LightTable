import { describe, expect, it } from 'vitest';
import { halfFloatToNormalizedU16 } from './halfFloatPixels';

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
});
