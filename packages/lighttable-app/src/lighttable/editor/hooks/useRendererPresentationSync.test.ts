import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCOPE_SETTINGS,
  DEFAULT_SCOPE_VISIBILITY
} from '../../scopes';
import { createLayerId } from '../document/documentTypes';
import { createVectorEditorSelection } from '../session/editorSession';
import {
  createScopeRendererOptions,
  presentedVectorEditingSelection
} from './useRendererPresentationSync';

describe('createScopeRendererOptions', () => {
  it('keeps shared hue analysis alive and projects visible scopes exactly', () => {
    const options = createScopeRendererOptions(
      {
        ...DEFAULT_SCOPE_VISIBILITY,
        parade: false,
        vectorscope: true
      },
      {
        ...DEFAULT_SCOPE_SETTINGS,
        traceBrightness: 0.42,
        vectorscopeZoom2x: true
      }
    );

    expect(options).toMatchObject({
      hueDistributionVisible: true,
      paradeVisible: false,
      vectorscopeVisible: true,
      traceBrightness: 0.42,
      vectorscopeZoom2x: true
    });
  });
});

describe('presentedVectorEditingSelection', () => {
  it('hides vector editing chrome without destroying semantic selection', () => {
    const selection = createVectorEditorSelection();
    const layerId = createLayerId();
    selection.elements = [{ layerId, elementId: 'rectangle' }];

    expect(presentedVectorEditingSelection(selection, true)).toBe(selection);
    expect(presentedVectorEditingSelection(selection, false)).toEqual(
      createVectorEditorSelection()
    );
    expect(selection.elements).toEqual([
      { layerId, elementId: 'rectangle' }
    ]);
  });
});
