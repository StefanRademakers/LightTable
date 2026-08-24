import { describe, expect, it } from 'vitest';
import { parseSemanticLayerRasterizeCommand } from './semanticLayerRasterizeCommandContract';

describe('semantic layer rasterize command contract', () => {
  it('accepts exactly one stable layer ID', () => {
    expect(parseSemanticLayerRasterizeCommand({ layerId: 'vector-1' }))
      .toEqual({ layerId: 'vector-1' });
  });

  it.each([
    null,
    [],
    {},
    { layerId: '' },
    { layerId: 'vector-1', unexpected: true }
  ])('rejects ambiguous input %#', (value) => {
    expect(parseSemanticLayerRasterizeCommand(value)).toHaveProperty('message');
  });
});
