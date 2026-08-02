import { describe, expect, it } from 'vitest';
import { BrushPercentInput } from './brushPercentInput';

describe('BrushPercentInput', () => {
  it('maps one digit and zero to Photoshop-style percentages', () => {
    const input = new BrushPercentInput();
    expect(input.input('opacity', 4, 0)).toBe(40);
    expect(input.input('opacity', 0, 1000)).toBe(100);
  });

  it('combines a quick pair but never crosses opacity and flow', () => {
    const input = new BrushPercentInput();
    expect(input.input('opacity', 4, 0)).toBe(40);
    expect(input.input('opacity', 5, 100)).toBe(45);
    expect(input.input('flow', 2, 200)).toBe(20);
  });
});
