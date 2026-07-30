import { describe, expect, it } from 'vitest';
import { normalizedDepthToHalf, normalizedFloatToHalf } from './float16';

describe('normalized depth float16 upload', () => {
  it('encodes the exact normalized endpoints', () => {
    expect(normalizedFloatToHalf(0)).toBe(0x0000);
    expect(normalizedFloatToHalf(1)).toBe(0x3c00);
  });

  it('clamps invalid and out-of-range depth values', () => {
    expect([...normalizedDepthToHalf(Float32Array.from([-1, Number.NaN, 2]))])
      .toEqual([0x0000, 0x0000, 0x3c00]);
  });
});
