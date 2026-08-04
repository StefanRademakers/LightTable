import { describe, expect, it } from 'vitest';
import {
  isVectorEditorTool,
  vectorToolActivation,
  type VectorEditorToolId
} from './vectorToolCatalog';

describe('vectorToolCatalog', () => {
  it('maps every visible vector tool to one framework-neutral mode', () => {
    const tools: VectorEditorToolId[] = [
      'vector-select',
      'vector-direct-select',
      'vector-pen',
      'vector-add-anchor',
      'vector-delete-anchor',
      'vector-convert-anchor',
      'shape-rectangle',
      'shape-ellipse',
      'shape-triangle',
      'shape-line',
      'gradient'
    ];
    for (const tool of tools) {
      expect(isVectorEditorTool(tool)).toBe(true);
      expect(vectorToolActivation(tool).mode).toBeTruthy();
    }
    expect(isVectorEditorTool('brush')).toBe(false);
  });

  it('keeps live-shape presentation separate from controller mode', () => {
    expect(vectorToolActivation('shape-rectangle')).toEqual({
      mode: 'live-shape',
      preset: { kind: 'rectangle' }
    });
    expect(vectorToolActivation('shape-line')).toEqual({
      mode: 'live-shape',
      preset: { kind: 'line' }
    });
  });
});
