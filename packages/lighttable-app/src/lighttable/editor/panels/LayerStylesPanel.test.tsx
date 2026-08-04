import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createImageDocument } from '../document/documentTypes';
import { createDefaultLayerStyleStack } from '../styles/layerStyleDefaults';
import type { LayerStyleEditorController } from '../../application/styles/useLayerStyleEditorController';
import { LayerStylesPanel, previewLayerStyleFromPanel } from './LayerStylesPanel';

const controller = (): LayerStyleEditorController => ({
  request: null,
  open: vi.fn(),
  preview: vi.fn(),
  cancel: vi.fn(),
  commit: vi.fn()
});

describe('LayerStylesPanel', () => {
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

    previewLayerStyleFromPanel(styles, 'layer' as never, stack);

    expect(styles.open).toHaveBeenCalledWith('layer');
    expect(styles.preview).toHaveBeenCalledWith(stack);
  });
});
