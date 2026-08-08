import React from 'react';
import { FormInput } from '../ui/FormInput';

export interface UiColorPickerColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

interface HsvColor {
  readonly h: number;
  readonly s: number;
  readonly v: number;
}

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const byte = (value: number) => Math.round(clamp(value) * 255);

export const colorPickerHex = (color: UiColorPickerColor) =>
  `#${[color.r, color.g, color.b].map((channel) => byte(channel)
    .toString(16).padStart(2, '0')).join('')}`.toUpperCase();

export const colorPickerRgbToHsv = (color: UiColorPickerColor): HsvColor => {
  const maximum = Math.max(color.r, color.g, color.b);
  const minimum = Math.min(color.r, color.g, color.b);
  const delta = maximum - minimum;
  let hue = 0;
  if (delta > 0) {
    if (maximum === color.r) hue = 60 * (((color.g - color.b) / delta) % 6);
    else if (maximum === color.g) hue = 60 * ((color.b - color.r) / delta + 2);
    else hue = 60 * ((color.r - color.g) / delta + 4);
  }
  return {
    h: hue < 0 ? hue + 360 : hue,
    s: maximum === 0 ? 0 : delta / maximum,
    v: maximum
  };
};

export const colorPickerHsvToRgb = (hsv: HsvColor, alpha = 1): UiColorPickerColor => {
  const hue = ((hsv.h % 360) + 360) % 360;
  const chroma = clamp(hsv.v) * clamp(hsv.s);
  const x = chroma * (1 - Math.abs((hue / 60) % 2 - 1));
  const match = clamp(hsv.v) - chroma;
  const [red, green, blue] = hue < 60 ? [chroma, x, 0]
    : hue < 120 ? [x, chroma, 0]
      : hue < 180 ? [0, chroma, x]
        : hue < 240 ? [0, x, chroma]
          : hue < 300 ? [x, 0, chroma]
            : [chroma, 0, x];
  return { r: red + match, g: green + match, b: blue + match, a: alpha };
};

const parseHex = (value: string, alpha: number): UiColorPickerColor | null => {
  const normalized = value.trim().replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return null;
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16) / 255,
    g: Number.parseInt(normalized.slice(2, 4), 16) / 255,
    b: Number.parseInt(normalized.slice(4, 6), 16) / 255,
    a: alpha
  };
};

export const UiColorPickerPrototype: React.FC<{
  readonly value: UiColorPickerColor;
  readonly onChange: (color: UiColorPickerColor) => void;
}> = ({ value, onChange }) => {
  const hsv = colorPickerRgbToHsv(value);
  const [hexDraft, setHexDraft] = React.useState(() => colorPickerHex(value));
  const [rgbDraft, setRgbDraft] = React.useState(() =>
    [byte(value.r), byte(value.g), byte(value.b)].map(String));
  const saturationPointer = React.useRef<number | null>(null);
  const huePointer = React.useRef<number | null>(null);

  React.useEffect(() => {
    setHexDraft(colorPickerHex(value));
    setRgbDraft([byte(value.r), byte(value.g), byte(value.b)].map(String));
  }, [value.r, value.g, value.b]);

  const updateSaturationValue = (element: HTMLElement, clientX: number, clientY: number) => {
    const bounds = element.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    onChange(colorPickerHsvToRgb({
      h: hsv.h,
      s: clamp((clientX - bounds.left) / bounds.width),
      v: 1 - clamp((clientY - bounds.top) / bounds.height)
    }, value.a));
  };
  const updateHue = (element: HTMLElement, clientX: number) => {
    const bounds = element.getBoundingClientRect();
    if (bounds.width <= 0) return;
    onChange(colorPickerHsvToRgb({ ...hsv, h: clamp((clientX - bounds.left) / bounds.width) * 360 }, value.a));
  };
  const updateRgb = (channel: number, draft: string) => {
    setRgbDraft((current) => current.map((item, index) => index === channel ? draft : item));
    if (!/^\d{1,3}$/.test(draft)) return;
    const next = Number(draft);
    if (next < 0 || next > 255) return;
    const channels = [value.r, value.g, value.b];
    channels[channel] = next / 255;
    onChange({ r: channels[0], g: channels[1], b: channels[2], a: value.a });
  };

  return (
    <div className="lighttable-color-picker-prototype" aria-label="Color picker prototype">
      <div className="lighttable-color-picker-prototype__sv" role="slider" tabIndex={0}
        aria-label="Saturation and brightness" aria-valuetext={`${Math.round(hsv.s * 100)}% saturation, ${Math.round(hsv.v * 100)}% brightness`}
        style={{ '--lighttable-picker-hue': `hsl(${hsv.h} 100% 50%)` } as React.CSSProperties}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          saturationPointer.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          updateSaturationValue(event.currentTarget, event.clientX, event.clientY);
        }}
        onPointerMove={(event) => {
          if (saturationPointer.current === event.pointerId) {
            updateSaturationValue(event.currentTarget, event.clientX, event.clientY);
          }
        }}
        onPointerUp={(event) => { saturationPointer.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }}
        onPointerCancel={() => { saturationPointer.current = null; }}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 0.1 : 0.01;
          let next = hsv;
          if (event.key === 'ArrowLeft') next = { ...hsv, s: clamp(hsv.s - step) };
          else if (event.key === 'ArrowRight') next = { ...hsv, s: clamp(hsv.s + step) };
          else if (event.key === 'ArrowDown') next = { ...hsv, v: clamp(hsv.v - step) };
          else if (event.key === 'ArrowUp') next = { ...hsv, v: clamp(hsv.v + step) };
          else return;
          event.preventDefault();
          onChange(colorPickerHsvToRgb(next, value.a));
        }}>
        <span className="lighttable-color-picker-prototype__sv-marker"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
      </div>
      <div className="lighttable-color-picker-prototype__hue" role="slider" tabIndex={0}
        aria-label="Hue" aria-valuemin={0} aria-valuemax={360} aria-valuenow={Math.round(hsv.h)}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          huePointer.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          updateHue(event.currentTarget, event.clientX);
        }}
        onPointerMove={(event) => {
          if (huePointer.current === event.pointerId) updateHue(event.currentTarget, event.clientX);
        }}
        onPointerUp={(event) => { huePointer.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }}
        onPointerCancel={() => { huePointer.current = null; }}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 10 : 1;
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowDown'
            && event.key !== 'ArrowRight' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          const direction = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 1;
          onChange(colorPickerHsvToRgb({ ...hsv, h: hsv.h + direction * step }, value.a));
        }}>
        <span className="lighttable-color-picker-prototype__hue-marker"
          style={{ left: `${hsv.h / 360 * 100}%` }} />
      </div>
      <div className="lighttable-color-picker-prototype__fields">
        <label><FormInput value={hexDraft} aria-label="Hex color" spellCheck={false}
          onChange={(event) => {
            const next = event.currentTarget.value;
            setHexDraft(next);
            const parsed = parseHex(next, value.a);
            if (parsed) onChange(parsed);
          }} onBlur={() => setHexDraft(colorPickerHex(value))} /><span>#</span></label>
        {['R', 'G', 'B'].map((label, channel) => (
          <label key={label}><FormInput value={rgbDraft[channel]} inputMode="numeric"
            aria-label={`${label} color channel`} onChange={(event) => updateRgb(channel, event.currentTarget.value)}
            onBlur={() => setRgbDraft([byte(value.r), byte(value.g), byte(value.b)].map(String))} />
            <span>{label}</span></label>
        ))}
      </div>
    </div>
  );
};
