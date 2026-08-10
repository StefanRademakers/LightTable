import { describe, expect, it } from 'vitest';
import { rankSubjectMask } from './smartSubjectRanking';

const mask = (width: number, height: number, predicate: (x: number, y: number) => boolean) => {
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) if (predicate(x, y)) data[y * width + x] = 255;
  }
  return data;
};

describe('rankSubjectMask', () => {
  it('rejects empty and almost-full background proposals', () => {
    expect(rankSubjectMask({ score: 1, data: new Uint8Array(100) }, 10, 10)).toBe(-Infinity);
    expect(rankSubjectMask({ score: 1, data: mask(10, 10, () => true) }, 10, 10)).toBe(-Infinity);
  });

  it('prefers an interior dominant object over a border-connected mask', () => {
    const interior = mask(20, 20, (x, y) => x >= 5 && x < 15 && y >= 4 && y < 16);
    const border = mask(20, 20, (x, y) => x < 6 && y >= 3 && y < 17);
    expect(rankSubjectMask({ score: 0.9, data: interior }, 20, 20))
      .toBeGreaterThan(rankSubjectMask({ score: 0.9, data: border }, 20, 20));
  });
});
