import { describe, expect, it } from 'vitest';
import { parseSemanticRasterInvertCommand } from './semanticRasterInvertCommandContract';

describe('semantic raster invert command contract', () => {
  it.each(['pixels', 'mask'] as const)('accepts an explicit %s target', (channel) => {
    expect(parseSemanticRasterInvertCommand({ layerId: 'photo', channel }))
      .toEqual({ layerId: 'photo', channel });
  });

  it.each([{}, { layerId: 'photo', channel: 'all' },
    { layerId: 'photo', channel: 'pixels', active: true }])('rejects %#', (value) => {
    expect(parseSemanticRasterInvertCommand(value)).toHaveProperty('message');
  });
});
