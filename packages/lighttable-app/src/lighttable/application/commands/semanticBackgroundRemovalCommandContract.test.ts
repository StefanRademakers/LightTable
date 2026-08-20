import { describe, expect, it } from 'vitest';
import { parseSemanticBackgroundRemovalCommand } from './semanticBackgroundRemovalCommandContract';

describe('semantic background removal command contract', () => {
  it.each(['replace', 'intersect', 'new-layer'] as const)('accepts explicit %s mode', (mode) => {
    expect(parseSemanticBackgroundRemovalCommand({ layerId: 'photo', mode }))
      .toEqual({ layerId: 'photo', mode });
  });

  it.each([null, {}, { layerId: '', mode: 'replace' }, { layerId: 'photo', mode: 'merge' },
    { layerId: 'photo', mode: 'replace', active: true }])('rejects %#', (value) => {
    expect(parseSemanticBackgroundRemovalCommand(value)).toHaveProperty('message');
  });
});
