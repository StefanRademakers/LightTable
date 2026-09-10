import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createImageDocument } from '../document/documentTypes';
import { createDefaultLayerStyleStack } from '../styles/layerStyleDefaults';
import type { LayerStyleEditorController } from '../../application/styles/useLayerStyleEditorController';
import {
  LayerStylesPanel,
  layerStyleEditorInstanceKey,
  layerStylePreviewIntervalForLayerCount,
  previewLayerStyleFromPanel
} from './LayerStylesPanel';

const controller = (): LayerStyleEditorController => ({
  request: null,
  draftGeneration: 0,
  open: vi.fn(),
  beginInteraction: vi.fn(),
  preview: vi.fn(),
  commitInteraction: vi.fn(),
  cancelInteraction: vi.fn(),
  cancel: vi.fn(),
  commit: vi.fn()
});

describe('LayerStylesPanel', () => {
  it('isolates editor drafts by document, layer and cancellation generation', () => {
    expect(layerStyleEditorInstanceKey('document-a' as never, 'shared-layer' as never, 0))
      .not.toBe(layerStyleEditorInstanceKey('document-b' as never, 'shared-layer' as never, 0));
    expect(layerStyleEditorInstanceKey('document-a' as never, 'shared-layer' as never, 0))
      .not.toBe(layerStyleEditorInstanceKey('document-a' as never, 'shared-layer' as never, 1));
  });

  it('does not render editable controls for a locked layer', () => {
    const document = createImageDocument('Image', 64, 32, 'source');
    document.layers = document.layers.map((layer) => ({
      ...layer, locks: { ...layer.locks, all: true }
    }));
    const markup = renderToStaticMarkup(
      <LayerStylesPanel document={document} controller={controller()} />
    );
    expect(markup).toContain('Unlock the layer to edit effects.');
    expect(markup).not.toContain('lighttable-style-editor');
  });

  it('keeps 30 Hz previews for normal documents and applies backpressure to large PSDs', () => {
    expect(layerStylePreviewIntervalForLayerCount(32)).toBe(33);
    expect(layerStylePreviewIntervalForLayerCount(33)).toBe(100);
  });
  it('does not open a style transaction merely because the persistent panel renders', () => {
    const document = createImageDocument('Image', 64, 32, 'source');
    const styles = controller();

    renderToStaticMarkup(<LayerStylesPanel document={document} controller={styles} />);

    expect(styles.open).not.toHaveBeenCalled();
    expect(styles.preview).not.toHaveBeenCalled();
    expect(styles.commit).not.toHaveBeenCalled();
  });

  it('opens lazily and previews only when the user authors a style change', () => {
    const styles = controller();
    const stack = createDefaultLayerStyleStack();

    const admission = { status: 'admitted' as const, handle: { sequence: 1 } };
    previewLayerStyleFromPanel(styles, 'layer' as never, stack, admission);

    expect(styles.open).toHaveBeenCalledWith('layer');
    expect(styles.preview).toHaveBeenCalledWith(stack, admission);
  });
});
