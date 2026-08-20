import { describe, expect, it } from 'vitest';
import { parseSemanticTextCommand } from './semanticTextCommandContract';

describe('semantic text command contract', () => {
  const pathCreate = {
    mode: 'path', text: 'Along the curve', origin: { x: 0, y: 0 },
    writingMode: 'horizontal-tb',
    path: {
      layerId: 'paths', elementId: 'title-path', subpathId: 'main-contour',
      startOffset: 18, side: 'right', upright: false, direction: 'reverse'
    }
  };

  it('parses native Path Text references and exact layout settings', () => {
    expect(parseSemanticTextCommand('create', pathCreate)).toEqual({
      kind: 'create', ...pathCreate
    });
  });

  it('rejects missing or malformed Path Text targets', () => {
    expect(parseSemanticTextCommand('create', {
      ...pathCreate, path: undefined
    })).toHaveProperty('message');
    expect(parseSemanticTextCommand('create', {
      ...pathCreate, path: { ...pathCreate.path, side: 'center' }
    })).toHaveProperty('message');
    expect(parseSemanticTextCommand('create', {
      ...pathCreate, path: { ...pathCreate.path, startOffset: Number.NaN }
    })).toHaveProperty('message');
    expect(parseSemanticTextCommand('create', {
      ...pathCreate, mode: 'point'
    })).toHaveProperty('message');
  });
});
