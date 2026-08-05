import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  createDefaultLayerStyle,
  createDefaultLayerStyleStack
} from '../styles/layerStyleDefaults';
import { LayerStyleEditor } from './LayerStyleEditor';

describe('LayerStyleEditor', () => {
  it('renders as a non-modal dock panel without dialog actions', () => {
    const initialStack = createDefaultLayerStyleStack();
    initialStack.effects = [createDefaultLayerStyle('drop-shadow')];
    const markup = renderToStaticMarkup(
      <LayerStyleEditor
        mode="panel"
        layerName="Shape"
        initialStack={initialStack}
        onPreview={vi.fn()}
      />
    );

    expect(markup).toContain('role="region"');
    expect(markup).toContain('lighttable-style-editor--panel');
    expect(markup).not.toContain('aria-modal="true"');
    expect(markup).not.toContain('>Cancel<');
    expect(markup).not.toContain('>OK<');
    expect(markup).toContain('aria-label="Disable Drop Shadow"');
    expect(markup).toContain('aria-label="Remove Drop Shadow"');
    expect(markup).not.toContain('>Enabled<');
    expect(markup).not.toContain('>Remove<');
    expect(markup).toContain('title="Blur"');
    expect(markup).toContain('title="Distance"');
    expect(markup).toContain('title="Opacity"');
    expect(markup).toContain('role="slider"');
    expect(markup).toContain('aria-label="Angle"');
    expect(markup).toContain('aria-label="Angle degrees"');
    expect(markup).toContain('<summary>Advanced</summary>');
    expect(markup).toContain('title="Spread"');
  });
});
