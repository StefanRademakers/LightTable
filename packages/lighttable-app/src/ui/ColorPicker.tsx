import React from 'react';
import { lightTableIcon } from '../assets/icons';
import { AdjustmentSlider } from './AdjustmentSlider';
import { FormInput } from './FormInput';
import { OpacitySlider } from './OpacitySlider';
import { SquareIconButton } from './SquareIconButton';
import { sampleScreenColor } from './colorSampling';

export interface ColorPickerColor { readonly r: number; readonly g: number; readonly b: number; readonly a: number }
interface HsvColor { readonly h: number; readonly s: number; readonly v: number }
interface HslColor { readonly h: number; readonly s: number; readonly l: number }
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

export interface ColorPickerProps {
  readonly value: ColorPickerColor;
  readonly onChange: (value: ColorPickerColor) => void;
  /** Optional paint opacity, kept separate from the RGB color value. */
  readonly opacity?: number;
  readonly onOpacityChange?: (opacity: number) => void;
}

export const ColorPicker: React.FC<ColorPickerProps> = ({
  value,
  onChange,
  opacity,
  onOpacityChange
}) => {
  const [hsv, setHsv] = React.useState(() => colorPickerHsvFromValue(value));
  const [hex, setHex] = React.useState(colorPickerHex(value));
  const [rgb, setRgb] = React.useState([byte(value.r), byte(value.g), byte(value.b)].map(String));
  const [sampling, setSampling] = React.useState(false);
  React.useEffect(() => {
    setHsv((current) => colorPickerHsvFromValue(value, current));
    setHex(colorPickerHex(value));
    setRgb([byte(value.r), byte(value.g), byte(value.b)].map(String));
  }, [value]);
  const commitHsv = (next: HsvColor) => {
    setHsv(next);
    onChange(colorPickerHsvToRgb(next, value.a));
  };
  const hsl = { ...colorPickerRgbToHsl(colorPickerHsvToRgb(hsv)), h: hsv.h };
  const commitHsl = (next: HslColor) => {
    const rgbColor = colorPickerHslToRgb(next, value.a);
    setHsv(colorPickerHsvFromValue(rgbColor, { h: next.h, s: 0, v: 0 }));
    onChange(rgbColor);
  };
  const updateSv = (element: HTMLElement, x: number, y: number) => {
    const bounds = element.getBoundingClientRect();
    commitHsv({ h: hsv.h, s: clamp((x - bounds.left) / bounds.width), v: 1 - clamp((y - bounds.top) / bounds.height) });
  };
  return <div className="lighttable-color-picker-prototype" role="dialog" aria-label="Color picker">
    <div className="lighttable-color-picker-prototype__sv" role="slider" aria-label="Saturation and brightness"
      aria-valuetext={`${Math.round(hsv.s * 100)}% saturation, ${Math.round(hsv.v * 100)}% brightness`}
      tabIndex={0} style={{ '--lighttable-picker-hue': `hsl(${hsv.h} 100% 50%)` } as React.CSSProperties}
      onPointerDown={(event) => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); updateSv(event.currentTarget, event.clientX, event.clientY); }}
      onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) updateSv(event.currentTarget, event.clientX, event.clientY); }}>
      <span className="lighttable-color-picker-prototype__sv-marker" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
    </div>
    <div className="lighttable-color-picker-prototype__hsl">
      <AdjustmentSlider label="Hue" layout="bare" value={hsl.h} min={0} max={360}
        format={(current) => `${Math.round(current)}°`} showResetMarker={false}
        trackBackground="linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)"
        onChange={(hue) => commitHsl({ ...hsl, h: hue })}
        onReset={() => commitHsl({ ...hsl, h: 0 })} />
      <AdjustmentSlider label="Saturation" layout="bare" value={hsl.s * 100} min={0} max={100}
        format={(current) => `${Math.round(current)}%`} showResetMarker={false}
        trackBackground={`linear-gradient(to right, hsl(${hsl.h} 0% ${hsl.l * 100}%), hsl(${hsl.h} 100% ${hsl.l * 100}%))`}
        onChange={(saturation) => commitHsl({ ...hsl, s: saturation / 100 })}
        onReset={() => commitHsl({ ...hsl, s: 0 })} />
      <AdjustmentSlider label="Luminosity" layout="bare" value={hsl.l * 100} min={0} max={100}
        format={(current) => `${Math.round(current)}%`} showResetMarker={false}
        trackBackground={`linear-gradient(to right, #000 0%, hsl(${hsl.h} 100% 50%) 50%, #fff 100%)`}
        onChange={(luminosity) => commitHsl({ ...hsl, l: luminosity / 100 })}
        onReset={() => commitHsl({ ...hsl, l: 0.5 })} />
    </div>
    {opacity !== undefined && onOpacityChange ? (
      <OpacitySlider value={opacity}
        color={`rgb(${byte(value.r)} ${byte(value.g)} ${byte(value.b)})`}
        onChange={onOpacityChange} />
    ) : null}
    <div className="lighttable-color-picker-prototype__fields">
      <SquareIconButton className="lighttable-color-picker-prototype__sampler" icon={<img src={lightTableIcon('tool_sample_color.png')} alt="" />}
        aria-label="Sample color from screen" disabled={sampling} onClick={() => { setSampling(true); void sampleScreenColor().then((sampled) => {
          const parsed = sampled ? colorPickerParseHex(sampled, value.a) : null; if (parsed) onChange(parsed);
        }).finally(() => setSampling(false)); }} />
      <label><FormInput value={hex} aria-label="Hex color" onChange={(event) => { setHex(event.currentTarget.value); const parsed = colorPickerParseHex(event.currentTarget.value, value.a); if (parsed) onChange(parsed); }} /><span>#</span></label>
      {['R', 'G', 'B'].map((label, channel) => <label key={label}><FormInput value={rgb[channel]} inputMode="numeric" aria-label={`${label} color channel`}
        onChange={(event) => { const draft = event.currentTarget.value; setRgb((current) => current.map((item, i) => i === channel ? draft : item)); const number = Number(draft); if (!Number.isInteger(number) || number < 0 || number > 255) return; const channels = [value.r, value.g, value.b]; channels[channel] = number / 255; onChange({ r: channels[0], g: channels[1], b: channels[2], a: value.a }); }} /><span>{label}</span></label>)}
    </div>
  </div>;
};
