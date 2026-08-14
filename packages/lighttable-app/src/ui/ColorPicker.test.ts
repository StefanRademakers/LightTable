import { describe, expect, it } from 'vitest';
import { colorPickerHsvFromValue } from './ColorPicker';

describe('ColorPicker hue state', () => {
  it('preserves the selected hue while an RGB value is achromatic', () => {
    expect(colorPickerHsvFromValue(
      { r: 0.25, g: 0.25, b: 0.25, a: 1 },
      { h: 214, s: 0, v: 0.25 }
    )).toEqual({ h: 214, s: 0, v: 0.25 });
  });

  it('adopts the hue encoded by a chromatic external value', () => {
    expect(colorPickerHsvFromValue(
      { r: 0, g: 1, b: 0, a: 1 },
      { h: 214, s: 0, v: 0.25 }
    )).toEqual({ h: 120, s: 1, v: 1 });
  });
});
