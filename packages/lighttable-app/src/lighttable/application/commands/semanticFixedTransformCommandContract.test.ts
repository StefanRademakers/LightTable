import { describe, expect, it } from 'vitest';
import { parseSemanticFixedTransformCommand } from './semanticFixedTransformCommandContract';

describe('semantic fixed transform command contract', () => {
  it.each([
    'rotate-180', 'rotate-clockwise-90', 'rotate-counter-clockwise-90',
    'flip-horizontal', 'flip-vertical'
  ] as const)('accepts %s', (operation) => {
    expect(parseSemanticFixedTransformCommand({ operation })).toEqual({ operation });
  });

  it.each([
    null,
    {},
    { operation: 'rotate-45' },
    { operation: 'flip-horizontal', layerId: 'implicit-target-is-forbidden' }
  ])('rejects malformed or ambiguous parameters %#', (parameters) => {
    expect(parseSemanticFixedTransformCommand(parameters)).toHaveProperty('message');
  });
});
