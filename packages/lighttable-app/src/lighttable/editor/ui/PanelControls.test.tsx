import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  PanelAdvancedDisclosure,
  PanelAngleControl,
  PanelCheckboxField,
  PanelColorSwatch,
  PanelNumberSlider,
  PanelSelectField
} from './PanelControls';

describe('shared panel controls', () => {
  it('uses one label and focus language for common property inputs', () => {
    const markup = renderToStaticMarkup(<>
      <PanelSelectField label="Mode" value="normal" options={[
        { value: 'normal', label: 'Normal' }
      ]} onChange={vi.fn()} />
      <PanelCheckboxField label="Enabled" checked onChange={vi.fn()} />
      <PanelColorSwatch label="Color" value={{ r: 1, g: 0, b: 0, a: 1 }} onChange={vi.fn()} />
      <PanelNumberSlider label="Opacity" value={50} min={0} max={100} suffix="%"
        onChange={vi.fn()} />
      <PanelAngleControl label="Angle" value={120} onChange={vi.fn()} />
      <PanelAdvancedDisclosure><span>Compatibility</span></PanelAdvancedDisclosure>
    </>);

    expect(markup).toContain('<span>Mode</span>');
    expect(markup).toContain('<span>Enabled</span>');
    expect(markup).toContain('value="#ff0000"');
    expect(markup).toContain('aria-label="Sample color"');
    expect(markup).toContain('title="Opacity"');
    expect(markup).toContain('aria-label="Angle"');
    expect(markup).toContain('<summary>Advanced</summary>');
    expect(markup).toContain('Compatibility');
  });
});
