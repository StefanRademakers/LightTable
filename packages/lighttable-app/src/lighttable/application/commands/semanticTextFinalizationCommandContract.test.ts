import { describe, expect, it } from 'vitest';
import { parseSemanticTextFinalizationCommand } from './semanticTextFinalizationCommandContract';

describe('semantic text finalization contract', () => {
  it('accepts exactly one stable layer ID', () => {
    expect(parseSemanticTextFinalizationCommand({ layerId: 'text-1' }, 'Text rasterize'))
      .toEqual({ layerId: 'text-1' });
  });

  it.each([null, {}, { layerId: '' }, { layerId: 'text-1', mode: 'fast' }])(
    'rejects ambiguous or expanded parameters: %o',
    (value) => expect(parseSemanticTextFinalizationCommand(value, 'Text rasterize'))
      .toHaveProperty('message')
  );
});
