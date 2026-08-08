import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  colorPickerHex,
  colorPickerHsvToRgb,
  colorPickerRgbToHsv,
  UiColorPickerPrototype
} from './UiColorPickerPrototype';

describe('UI color picker prototype', () => {
  it('round-trips RGB through the HSV interaction model', () => {
    const source = { r: 0.12, g: 0.48, b: 0.95, a: 0.75 };
    const result = colorPickerHsvToRgb(colorPickerRgbToHsv(source), source.a);
    expect(result.r).toBeCloseTo(source.r, 6);
    expect(result.g).toBeCloseTo(source.g, 6);
    expect(result.b).toBeCloseTo(source.b, 6);
    expect(result.a).toBe(source.a);
  });

  it('uses canonical form inputs for Hex and RGB editing', () => {
    const value = { r: 0, g: 122 / 255, b: 204 / 255, a: 1 };
    const markup = renderToStaticMarkup(
      <UiColorPickerPrototype value={value} onChange={vi.fn()} />
    );
    expect(colorPickerHex(value)).toBe('#007ACC');
    expect(markup).toContain('class="lighttable-color-picker-prototype"');
    expect(markup).toContain('aria-label="Saturation and brightness"');
    expect(markup).toContain('aria-label="Hue"');
    expect(markup).toContain('aria-label="Sample color from screen"');
    expect(markup).toContain('tool_sample_color');
    expect(markup).toContain('lighttable-color-picker-prototype__sampler');
    expect(markup.match(/class="form-input"/g)).toHaveLength(4);
    expect(markup).toContain('value="#007ACC"');
  });
});
