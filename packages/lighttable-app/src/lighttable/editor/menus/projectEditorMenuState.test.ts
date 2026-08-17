import { describe, expect, it } from 'vitest';
import {
  createRasterLayer,
  createTextLayer,
  setActiveLayer,
  setLayerLock
} from '../document/documentCommands';
import { createDefaultTextLayerData } from '@lighttable/text-core';
import { createImageDocument } from '../document/documentTypes';
import { projectEditorMenuState } from './projectEditorMenuState';

const baseInput = () => ({
  document: createImageDocument('Menu', 64, 64, 'background'),
  saving: false,
  hasMetadata: true,
  hasSourceKey: true,
  hasCompatibilityReport: false,
  copiedGradeName: null,
  hasSelection: false,
  selectionClipboardAvailable: false,
  activeChannel: 'pixels' as const,
  autoAlignPreview: false,
  zoomMode: 'fit' as const,
  showDifference: false
});

describe('projectEditorMenuState', () => {
  it('projects a plain document without UI-specific document traversal', () => {
    const state = projectEditorMenuState(baseInput());

    expect(state.hasDocument).toBe(true);
    expect(state.layer?.type).toBe('raster');
    expect(state.autoAlignAvailable).toBe(false);
    expect(state.blendModes.find((mode) => mode.id === 'normal')?.selected).toBe(true);
  });

  it('enables auto align only for one visible locked reference raster', () => {
    const layered = createRasterLayer(baseInput().document, 'Target');
    const referenceId = layered.layers[0]!.id;
    const withLockedReference = setLayerLock(layered, referenceId, 'all', true);
    const state = projectEditorMenuState({
      ...baseInput(),
      document: withLockedReference
    });

    expect(state.autoAlignAvailable).toBe(true);
  });

  it('returns an inert document projection when no document is active', () => {
    const state = projectEditorMenuState({
      ...baseInput(),
      document: null,
      hasMetadata: false,
      hasSourceKey: false
    });

    expect(state.hasDocument).toBe(false);
    expect(state.layer).toBeNull();
    expect(state.rasterLayerCount).toBe(0);
    expect(state.autoAlignAvailable).toBe(false);
  });

  it('disables delete for the final raster even when a text layer also exists', () => {
    const withText = createTextLayer(
      baseInput().document,
      createDefaultTextLayerData(),
      'Text'
    );
    const rasterId = withText.layers.find((layer) => layer.type === 'raster')!.id;
    const state = projectEditorMenuState({
      ...baseInput(),
      document: setActiveLayer(withText, rasterId)
    });

    expect(state.layer?.canDelete).toBe(false);
  });
});
