import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ColorPicker, colorPickerHslToRgb, colorPickerRgbToHsl } from './ColorPicker';
import { DocumentPaletteProvider } from './DocumentPaletteContext';

const color = { r: 0.1, g: 0.4, b: 0.9, a: 1 };

describe('ColorPicker opacity', () => {
  it('round-trips RGB through its HSL controls', () => {
    const result = colorPickerHslToRgb(colorPickerRgbToHsl(color), color.a);
    expect(result.r).toBeCloseTo(color.r, 6);
    expect(result.g).toBeCloseTo(color.g, 6);
    expect(result.b).toBeCloseTo(color.b, 6);
  });

  it('keeps opacity optional for callers that only edit RGB', () => {
    const markup = renderToStaticMarkup(<ColorPicker value={color} onChange={vi.fn()} />);
    expect(markup).not.toContain('aria-label="Color opacity"');
    expect(markup).not.toContain('aria-label="Color opacity percentage"');
    expect(markup).toContain('aria-label="Hue"');
    expect(markup).toContain('aria-label="Saturation"');
    expect(markup).toContain('aria-label="Luminosity"');
    expect(markup).not.toContain('>Hue<');
    expect(markup).not.toContain('>Saturation<');
    expect(markup).not.toContain('>Luminosity<');
  });

  it('uses the canonical inline slider without a duplicate percentage field', () => {
    const markup = renderToStaticMarkup(
      <ColorPicker value={color} onChange={vi.fn()} opacity={0.45} onOpacityChange={vi.fn()} />
    );
    expect(markup).toContain('aria-label="Color opacity"');
    expect(markup).not.toContain('aria-label="Color opacity percentage"');
    expect(markup).toContain('data-layout="inline"');
    expect(markup).toContain('>45%</output>');
    expect(markup).toContain('type="range"');
    expect(markup).toContain('value="45"');
  });

  it('only presents the on-demand image palette inside a document palette owner', () => {
    const standalone = renderToStaticMarkup(<ColorPicker value={color} onChange={vi.fn()} />);
    const documentPicker = renderToStaticMarkup(
      <DocumentPaletteProvider loadPalette={vi.fn()}>
        <ColorPicker value={color} onChange={vi.fn()} />
      </DocumentPaletteProvider>
    );
    expect(standalone).not.toContain('Image Palette');
    expect(documentPicker).toContain('Image Palette');
    expect(documentPicker).toContain('Analyzing image');
  });
});
