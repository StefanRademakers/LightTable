import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createDefaultLayerStyleStack } from '../styles/layerStyleDefaults';
import { LayerStyleEditor } from './LayerStyleEditor';

describe('LayerStyleEditor', () => {
  it('renders as a non-modal dock panel without dialog actions', () => {
    const markup = renderToStaticMarkup(
      <LayerStyleEditor
        mode="panel"
        layerName="Shape"
        initialStack={createDefaultLayerStyleStack()}
        onPreview={vi.fn()}
      />
    );

    expect(markup).toContain('role="region"');
    expect(markup).toContain('lighttable-style-editor--panel');
    expect(markup).not.toContain('aria-modal="true"');
    expect(markup).not.toContain('>Cancel<');
    expect(markup).not.toContain('>OK<');
  });
});
