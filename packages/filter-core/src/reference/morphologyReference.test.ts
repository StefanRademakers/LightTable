import { describe, expect, it } from 'vitest';
import { morphologyReferenceRgba } from './morphologyReference';

const impulse = () => {
  const data = new Float32Array(5 * 5 * 4);
  data[(2 * 5 + 2) * 4] = 2;
  data[(2 * 5 + 2) * 4 + 3] = 1;
  return data;
};

describe('morphology reference oracle', () => {
  it('distinguishes round and square Maximum support without clipping HDR', () => {
    const round = morphologyReferenceRgba(impulse(), 5, 5, 1, 'maximum', 'round');
    const square = morphologyReferenceRgba(impulse(), 5, 5, 1, 'maximum', 'square');
    expect(round[(1 * 5 + 1) * 4]).toBe(0);
    expect(square[(1 * 5 + 1) * 4]).toBe(2);
    expect(round[(2 * 5 + 1) * 4]).toBe(2);
  });

  it('applies Minimum independently to premultiplied RGBA channels', () => {
    const source = new Float32Array([
      1, 0.8, 0.6, 1,
      0.2, 0.3, 0.4, 0.5,
      0.9, 0.7, 0.5, 0.75
    ]);
    const result = morphologyReferenceRgba(source, 3, 1, 1, 'minimum', 'square');
    expect(Array.from(result.slice(4, 8))).toEqual([
      expect.closeTo(0.2), expect.closeTo(0.3), expect.closeTo(0.4), expect.closeTo(0.5)
    ]);
  });
});
