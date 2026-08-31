export interface ColorPickerColor { readonly r: number; readonly g: number; readonly b: number; readonly a: number }
export interface HsvColor { readonly h: number; readonly s: number; readonly v: number }
export interface HslColor { readonly h: number; readonly s: number; readonly l: number }
const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const byte = (value: number) => Math.round(clamp(value) * 255);
export const colorPickerHex = (color: ColorPickerColor) => `#${[color.r, color.g, color.b]
  .map((channel) => byte(channel).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
export const colorPickerParseHex = (value: string, alpha = 1): ColorPickerColor | null => {
  const hex = value.trim().replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
  return { r: parseInt(hex.slice(0, 2), 16) / 255, g: parseInt(hex.slice(2, 4), 16) / 255,
    b: parseInt(hex.slice(4, 6), 16) / 255, a: alpha };
};
export const colorPickerRgbToHsv = (color: ColorPickerColor): HsvColor => {
  const maximum = Math.max(color.r, color.g, color.b);
  const minimum = Math.min(color.r, color.g, color.b);
  const delta = maximum - minimum;
  let h = 0;
  if (delta > 0) h = maximum === color.r ? 60 * (((color.g - color.b) / delta) % 6)
    : maximum === color.g ? 60 * ((color.b - color.r) / delta + 2)
      : 60 * ((color.r - color.g) / delta + 4);
  return { h: h < 0 ? h + 360 : h, s: maximum === 0 ? 0 : delta / maximum, v: maximum };
};
export const colorPickerHsvToRgb = (hsv: HsvColor, a = 1): ColorPickerColor => {
  const h = ((hsv.h % 360) + 360) % 360;
  const c = clamp(hsv.v) * clamp(hsv.s);
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = clamp(hsv.v) - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: r + m, g: g + m, b: b + m, a };
};
export const colorPickerRgbToHsl = (color: ColorPickerColor): HslColor => {
  const maximum = Math.max(color.r, color.g, color.b);
  const minimum = Math.min(color.r, color.g, color.b);
  const delta = maximum - minimum;
  const l = (maximum + minimum) / 2;
  const h = colorPickerRgbToHsv(color).h;
  return { h, s: delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1)), l };
};
export const colorPickerHslToRgb = (hsl: HslColor, a = 1): ColorPickerColor => {
  const h = ((hsl.h % 360) + 360) % 360;
  const s = clamp(hsl.s);
  const l = clamp(hsl.l);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0]
    : h < 180 ? [0, c, x] : h < 240 ? [0, x, c]
      : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: r + m, g: g + m, b: b + m, a };
};

/**
 * Hue is not encoded in achromatic RGB colours. Keep the user's last hue in
 * that case so choosing a hue before adding saturation remains possible.
 */
export const colorPickerHsvFromValue = (color: ColorPickerColor, previous?: HsvColor): HsvColor => {
  const next = colorPickerRgbToHsv(color);
  return next.s <= 1e-6 || next.v <= 1e-6
    ? { ...next, h: previous?.h ?? next.h }
    : next;
};
