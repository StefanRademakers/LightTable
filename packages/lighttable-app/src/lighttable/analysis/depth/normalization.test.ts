import { describe, expect, it } from 'vitest';
import { normalizeRelativeDepth, sampleMedianDepth } from './normalization';

describe('depth normalization', () => {
  it('maps larger relative depth to near=1 and clips percentile outliers', () => {
    const raw = Float32Array.from([0, 1, 2, 3, 4, 1000]);
    const result = normalizeRelativeDepth(raw, 3, 2);
    expect(result.nearIsOne).toBe(true);
    expect(result.data[0]).toBe(0);
    expect(result.data[5]).toBe(1);
    expect(result.data[3]).toBeGreaterThan(result.data[1]);
  });

  it('stabilizes a flat depth map at the middle plane', () => {
    const result = normalizeRelativeDepth(new Float32Array(16).fill(4), 4, 4);
    expect([...result.data]).toEqual(new Array(16).fill(0.5));
  });

  it('samples a local median instead of a depth-edge outlier', () => {
    const data = new Float32Array(49).fill(0.25);
    data[24] = 1;
    expect(sampleMedianDepth({ width: 7, height: 7, data, nearIsOne: true }, 0.5, 0.5)).toBe(0.25);
  });
});
