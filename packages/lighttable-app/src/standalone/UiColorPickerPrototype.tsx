import React from 'react';
import {
  ColorPicker,
  colorPickerHex,
  colorPickerHsvToRgb,
  colorPickerRgbToHsv,
  type ColorPickerColor
} from '../ui/ColorPicker';

export type UiColorPickerColor = ColorPickerColor;
export { colorPickerHex, colorPickerHsvToRgb, colorPickerRgbToHsv };

/** Style-guide compatibility wrapper around the production color picker. */
export const UiColorPickerPrototype: React.FC<{
  readonly value: UiColorPickerColor;
  readonly onChange: (color: UiColorPickerColor) => void;
  readonly opacity?: number;
  readonly onOpacityChange?: (opacity: number) => void;
}> = ({ value, onChange, opacity, onOpacityChange }) => <ColorPicker
  value={value} onChange={onChange} opacity={opacity} onOpacityChange={onOpacityChange} />;
