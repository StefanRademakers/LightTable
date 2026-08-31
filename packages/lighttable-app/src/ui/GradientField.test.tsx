import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GradientField, gradientFieldBackground, type GradientFieldValue } from '@lighttable/ui';

const gradient: GradientFieldValue = {
  colorStops: [
    { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
    { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } }
  ],
  opacityStops: [
    { position: 0, opacity: 0.5 },
    { position: 1, opacity: 1 }
  ]
};

describe('GradientField', () => {
  it('projects color and opacity into the shared compact field', () => {
    expect(gradientFieldBackground(gradient)).toContain('rgba(255, 0, 0, 0.500) 0.00%');
    const markup = renderToStaticMarkup(
      <GradientField value={gradient} ariaLabel="Edit gradient" expanded onClick={vi.fn()} />
    );
    expect(markup).toContain('data-suite-control="gradient-field"');
    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('class="ui-paint-field__chevron"');
    expect(markup).not.toContain('>Gradient<');
  });

  it('offers the same compact field variant used by color swatches', () => {
    const markup = renderToStaticMarkup(
      <GradientField value={gradient} size="compact" ariaLabel="Edit gradient" onClick={vi.fn()} />
    );
    expect(markup).toContain('data-suite-variant="compact"');
  });
});
