import { describe, expect, it } from 'vitest';
import { alignPackedPointTextBaseline } from './pointTextBaseline';

describe('point text baseline normalization', () => {
  it('moves every packed Y table by the first-line baseline delta', () => {
    const glyphGeometry = new Float32Array([3, 47, 8, 0, 11, 47, 9, 0]);
    const lineGeometry = new Float32Array([47, 40, 10, 3, 7, 17, 50]);
    const caretGeometry = new Float32Array([3, 7, 50, 20, 7, 50]);
    const selectionGeometry = new Float32Array([3, 7, 17, 50]);
    const bounds = new Float32Array([3, 9, 17, 38, 3, 7, 17, 50]);

    expect(alignPackedPointTextBaseline({
      glyphGeometry, lineGeometry, caretGeometry, selectionGeometry, bounds
    }, 0)).toBe(-47);
    expect([...glyphGeometry]).toEqual([3, 0, 8, 0, 11, 0, 9, 0]);
    expect([...lineGeometry]).toEqual([0, 40, 10, 3, -40, 17, 50]);
    expect([...caretGeometry]).toEqual([3, -40, 50, 20, -40, 50]);
    expect([...selectionGeometry]).toEqual([3, -40, 17, 50]);
    expect([...bounds]).toEqual([3, -38, 17, 38, 3, -40, 17, 50]);
  });

  it('leaves empty and already aligned point layouts untouched', () => {
    const empty = {
      glyphGeometry: new Float32Array(), lineGeometry: new Float32Array(),
      caretGeometry: new Float32Array(), selectionGeometry: new Float32Array(),
      bounds: new Float32Array()
    };
    expect(alignPackedPointTextBaseline(empty, 0)).toBe(0);
    const aligned = { ...empty, lineGeometry: new Float32Array([4, 3, 1, 0, 1, 2, 4]) };
    expect(alignPackedPointTextBaseline(aligned, 4)).toBe(0);
  });
});
