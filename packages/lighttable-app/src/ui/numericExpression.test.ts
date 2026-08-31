import { describe, expect, it } from 'vitest';
import { evaluateNumericExpression, resolveNumericExpression } from '@lighttable/ui';

describe('numeric expressions', () => {
  it('evaluates arithmetic with standard precedence and parentheses', () => {
    expect(evaluateNumericExpression('1920/2')).toBe(960);
    expect(evaluateNumericExpression('(100 + 20) * 1.5')).toBe(180);
    expect(evaluateNumericExpression('-10 + +2')).toBe(-8);
    expect(evaluateNumericExpression('2,5 * 4')).toBe(10);
  });

  it('rejects malformed, unsafe and non-finite input', () => {
    expect(evaluateNumericExpression('10 / 0')).toBeNull();
    expect(evaluateNumericExpression('Math.random()')).toBeNull();
    expect(evaluateNumericExpression('2 +')).toBeNull();
    expect(evaluateNumericExpression('2px')).toBeNull();
  });

  it('supports integer and floating-point field policies', () => {
    expect(resolveNumericExpression('1921 / 2', 'integer')).toBe(961);
    expect(resolveNumericExpression('1921 / 2', 'float')).toBe(960.5);
  });
});
