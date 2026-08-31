import { PanelSection } from '@lighttable/ui';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  PanelAngleControl,
  PanelCheckboxField,
  PanelColorSwatch,
  PanelFileField,
  PanelNumberSlider,
  PanelSelectField
} from './PanelControls';

describe('shared panel controls', () => {
  it('uses one label and focus language for common property inputs', () => {
    const markup = renderToStaticMarkup(<>
      <PanelSelectField label="Mode" value="normal" options={[
        { value: 'normal', label: 'Normal' }
      ]} onChange={vi.fn()} />
      <PanelFileField label="3D LUT" buttonLabel="Load .cube..." accept=".cube"
        onFile={vi.fn()} />
      <PanelCheckboxField label="Enabled" checked onChange={vi.fn()} />
      <PanelColorSwatch label="Color" value={{ r: 1, g: 0, b: 0, a: 1 }} onChange={vi.fn()} />
      <PanelNumberSlider label="Opacity" value={50} min={0} max={100} suffix="%"
        onChange={vi.fn()} />
      <PanelAngleControl label="Angle" value={120} onChange={vi.fn()} />
      <PanelSection label="Advanced" keepMounted><span>Compatibility</span></PanelSection>
    </>);

    expect(markup).toContain('<span>Mode</span>');
    expect(markup).toContain('<span>3D LUT</span>');
    expect(markup).toContain('Load .cube...');
    expect(markup).toContain('class="ui-button"');
    expect(markup).toContain('aria-label="Enabled"');
    expect(markup).toContain('--ui-paint-preview:linear-gradient(#ff0000, #ff0000)');
    expect(markup).toContain('aria-label="Sample color"');
    expect(markup).toContain('title="Opacity"');
    expect(markup).toContain('aria-label="Angle"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('Compatibility');
    expect(markup).toContain('data-suite-control="panel-select"');
    expect(markup).toContain('data-suite-control="panel-file"');
    expect(markup).toContain('data-suite-control="panel-checkbox"');
    expect(markup).toContain('data-suite-control="panel-angle"');
    expect(markup).toContain('data-suite-control="panel-section"');
  });
});
