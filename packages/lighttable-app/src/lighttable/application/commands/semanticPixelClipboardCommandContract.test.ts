import { describe, expect, it } from 'vitest';
import {
  parseSemanticCopyPixelsCommand,
  parseSemanticPastePixelsCommand
} from './semanticPixelClipboardCommandContract';

describe('semantic pixel clipboard command contract', () => {
  it('accepts only a closed semantic source', () => {
    expect(parseSemanticCopyPixelsCommand({ source: 'active-layer' }))
      .toEqual({ source: 'active-layer' });
    expect(parseSemanticCopyPixelsCommand({ source: 'merged' }))
      .toEqual({ source: 'merged' });
    expect(parseSemanticCopyPixelsCommand({ source: 'merged', pixels: 'base64' }))
      .toEqual({ message: 'Copy Pixels requires exactly source "active-layer" or "merged".' });
    expect(parseSemanticCopyPixelsCommand({ source: 'sam2.1' })).toHaveProperty('message');
  });

  it('accepts only an opaque artifact, finite bounds and an optional safe name', () => {
    expect(parseSemanticPastePixelsCommand({
      artifactId: 'artifact-1', bounds: { x: -4, y: 8, width: 20, height: 12 },
      name: 'Pasted Selection'
    })).toEqual({
      artifactId: 'artifact-1', bounds: { x: -4, y: 8, width: 20, height: 12 },
      name: 'Pasted Selection'
    });
    expect(parseSemanticPastePixelsCommand({
      artifactId: 'artifact-1', bounds: { x: 0, y: 0, width: 20, height: 12 },
      bytesBase64: 'private'
    })).toHaveProperty('message');
    expect(parseSemanticPastePixelsCommand({
      artifactId: 'artifact-1', bounds: { x: 0, y: 0, width: 0, height: 12 }
    })).toHaveProperty('message');
  });
});
