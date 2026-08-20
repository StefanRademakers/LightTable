import { describe, expect, it } from 'vitest';
import { parseSemanticFlattenGroupCommand, parseSemanticFlattenImageCommand,
  parseSemanticLayerMergeCommand } from './semanticMergeFlattenCommandContract';

describe('semantic merge and flatten contracts', () => {
  it('accepts explicit bounded targets', () => {
    expect(parseSemanticLayerMergeCommand({ layerIds: ['bottom', 'top'] }))
      .toEqual({ layerIds: ['bottom', 'top'] });
    expect(parseSemanticFlattenGroupCommand({ groupId: 'group' })).toEqual({ groupId: 'group' });
    expect(parseSemanticFlattenImageCommand({})).toEqual({});
  });

  it('rejects duplicates, contextual targets and expanded image options', () => {
    expect(parseSemanticLayerMergeCommand({ layerIds: ['same', 'same'] })).toHaveProperty('message');
    expect(parseSemanticFlattenGroupCommand({})).toHaveProperty('message');
    expect(parseSemanticFlattenImageCommand({ preserveLayers: true })).toHaveProperty('message');
  });
});
