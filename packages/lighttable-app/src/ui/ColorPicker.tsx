import React from 'react';
import { lightTableIcon } from '../assets/icons';
import { FormInput } from './FormInput';
import { SquareIconButton } from './SquareIconButton';
import { sampleScreenColor } from './colorSampling';

export interface ColorPickerColor { readonly r: number; readonly g: number; readonly b: number; readonly a: number }
interface HsvColor { readonly h: number; readonly s: number; readonly v: number }
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

export const ColorPicker: React.FC<{ value: ColorPickerColor; onChange: (value: ColorPickerColor) => void }> = ({ value, onChange }) => {
  const hsv = colorPickerRgbToHsv(value);
  const [hex, setHex] = React.useState(colorPickerHex(value));
  const [rgb, setRgb] = React.useState([byte(value.r), byte(value.g), byte(value.b)].map(String));
  const [sampling, setSampling] = React.useState(false);
  React.useEffect(() => { setHex(colorPickerHex(value)); setRgb([byte(value.r), byte(value.g), byte(value.b)].map(String)); }, [value]);
  const updateSv = (element: HTMLElement, x: number, y: number) => {
    const bounds = element.getBoundingClientRect();
    onChange(colorPickerHsvToRgb({ h: hsv.h, s: clamp((x - bounds.left) / bounds.width), v: 1 - clamp((y - bounds.top) / bounds.height) }, value.a));
  };
  const updateHue = (element: HTMLElement, x: number) => {
    const bounds = element.getBoundingClientRect();
    onChange(colorPickerHsvToRgb({ ...hsv, h: clamp((x - bounds.left) / bounds.width) * 360 }, value.a));
  };
  return <div className="lighttable-color-picker-prototype" role="dialog" aria-label="Color picker">
    <div className="lighttable-color-picker-prototype__sv" role="slider" aria-label="Saturation and brightness"
      aria-valuetext={`${Math.round(hsv.s * 100)}% saturation, ${Math.round(hsv.v * 100)}% brightness`}
      tabIndex={0} style={{ '--lighttable-picker-hue': `hsl(${hsv.h} 100% 50%)` } as React.CSSProperties}
      onPointerDown={(event) => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); updateSv(event.currentTarget, event.clientX, event.clientY); }}
      onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) updateSv(event.currentTarget, event.clientX, event.clientY); }}>
      <span className="lighttable-color-picker-prototype__sv-marker" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
    </div>
    <div className="lighttable-color-picker-prototype__hue" role="slider" aria-label="Hue"
      aria-valuemin={0} aria-valuemax={360} aria-valuenow={Math.round(hsv.h)} tabIndex={0}
      onPointerDown={(event) => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); updateHue(event.currentTarget, event.clientX); }}
      onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) updateHue(event.currentTarget, event.clientX); }}>
      <span className="lighttable-color-picker-prototype__hue-marker" style={{ left: `${hsv.h / 360 * 100}%` }} />
    </div>
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
