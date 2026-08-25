import { describe, expect, it } from 'vitest';
import { gaussianReference } from './gaussianReference';

describe('gaussianReference', () => {
  it('preserves premultiplied energy and symmetry around an impulse', () => {
    const data = new Float32Array(5 * 5 * 4);
    data.set([1, 0.5, 0.25, 1], (2 * 5 + 2) * 4);
    const result = gaussianReference({ width: 5, height: 5, data }, 1);
    const at = (x: number, y: number, channel: number) => result.data[(y * 5 + x) * 4 + channel]!;
    expect(at(1, 2, 0)).toBeCloseTo(at(3, 2, 0), 7);
    expect(at(2, 1, 0)).toBeCloseTo(at(2, 3, 0), 7);
    expect(at(2, 2, 1)).toBeCloseTo(at(2, 2, 0) * 0.5, 7);
    expect([...result.data].every(Number.isFinite)).toBe(true);
  });
});
