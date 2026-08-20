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
    expect(parseSemanticTextCommand('create', {
      ...pathCreate, frame: { width: 100, height: 40 }
    })).toHaveProperty('message');
  });

  it('rejects empty edits and bounds text offsets consistently with schema v1', () => {
    expect(parseSemanticTextCommand('format', { layerId: 'text' })).toHaveProperty('message');
    expect(parseSemanticTextCommand('layout', { layerId: 'text' })).toHaveProperty('message');
    expect(parseSemanticTextCommand('replace', {
      layerId: 'text', start: 0, end: 1_000_001, text: 'x'
    })).toHaveProperty('message');
  });
});
