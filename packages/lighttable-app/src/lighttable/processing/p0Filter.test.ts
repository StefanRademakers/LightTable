import { describe, expect, it } from 'vitest';
import { P0_FILTER_DEFINITIONS } from '@lighttable/filter-core';
import {
  createP0FilterStack,
  p0FilterKindForStack,
  p0FilterSettings,
  setP0FilterSettings
} from './p0Filter';

describe('P0 filter canonical model', () => {
  it.each(P0_FILTER_DEFINITIONS)('round-trips normalized $kind settings', (definition) => {
    const stack = createP0FilterStack(definition.kind, definition.defaults, (part) => part);
    expect(p0FilterKindForStack(stack)).toBe(definition.kind);
    expect(p0FilterSettings(stack, definition.kind)).toEqual(definition.defaults);
  });

  it('increments only the affected module and stack revision', () => {
    const stack = createP0FilterStack('high-pass', {}, (part) => part);
    const next = setP0FilterSettings(stack, 'high-pass', { radius: 22 });
    expect(next).not.toBe(stack);
    expect(next.revision).toBe(1);
    expect(next.modules[0]?.revision).toBe(1);
    expect(p0FilterSettings(next, 'high-pass')).toEqual({ radius: 22 });
    expect(setP0FilterSettings(next, 'high-pass', { radius: 22 })).toBe(next);
  });
});
