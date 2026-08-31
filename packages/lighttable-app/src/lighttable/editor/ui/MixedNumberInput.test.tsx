import { describe, expect, it } from 'vitest';
import { numericIncrement, parseBoundedNumber } from '@lighttable/ui';

describe('mixed numeric property input', () => {
  it('uses normal, coarse and fine keyboard increments', () => {
    expect(numericIncrement(10, 1, 1, {})).toBe(11);
    expect(numericIncrement(10, -1, 1, { shiftKey: true })).toBe(0);
    expect(numericIncrement(10, 1, 1, { altKey: true })).toBeCloseTo(10.1);
  });

  it('does not interpret an empty or partial draft as zero', () => {
    expect(parseBoundedNumber('', -1000, 1000)).toBeNull();
    expect(parseBoundedNumber('   ', -1000, 1000)).toBeNull();
    expect(parseBoundedNumber('-', -1000, 1000)).toBeNull();
    expect(parseBoundedNumber('0', -1000, 1000)).toBe(0);
    expect(parseBoundedNumber('1001', -1000, 1000)).toBeNull();
  });
});
