import React from 'react';
import { Slider, SliderField } from './Slider';
import { SegmentedControl } from './SegmentedControl';
import { TextInput } from './TextInput';
import { IconButton } from './IconButton';
import { MaskIcon } from './MaskIcon';
import { pipetteIconUrl } from './icons';
import { ColorArea } from './ColorArea';
import { ColorSwatches, type ColorSwatch } from './ColorSwatches';
import { colorPickerHex, colorPickerParseHex, colorPickerHsvFromValue, colorPickerHsvToRgb,
  colorPickerRgbToHsl, colorPickerHslToRgb, type ColorPickerColor, type HsvColor, type HslColor } from './colorUtils';

export interface ColorPickerProps {
  value: ColorPickerColor;
  onChange: (value: ColorPickerColor) => void;
  /** Paint opacity is independent of the RGB value's alpha. */
  opacity?: number;
  onOpacityChange?: (value: number) => void;
  variant?: 'popover' | 'panel';
  /** Presence enables Document Colors. The host owns analysis and loading. */
  documentColors?: readonly ColorSwatch[];
  documentColorsStatus?: string;
  /** Presence enables Palette. The host owns persistence. */
  palette?: readonly string[];
  onPaletteChange?: (colors: readonly string[]) => void;
  onSample?: () => Promise<string | null>;
  sampleIcon?: React.ReactNode;
}
const byte = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 255);
const defaultSampler = <MaskIcon src={pipetteIconUrl} />;

/** Complete color editor; contains no app services, storage or document work. */
export function ColorPicker({ value, onChange, opacity, onOpacityChange, variant = 'popover',
  documentColors, documentColorsStatus, palette, onPaletteChange, onSample, sampleIcon }: ColorPickerProps) {
  const [hsv, setHsv] = React.useState(() => colorPickerHsvFromValue(value));
  const [hex, setHex] = React.useState(colorPickerHex(value));
  const [rgb, setRgb] = React.useState([byte(value.r), byte(value.g), byte(value.b)].map(String));
  const [sampling, setSampling] = React.useState(false);
  const [paletteView, setPaletteView] = React.useState('document');
  const mounted = React.useRef(true);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const sample = async () => {
    if (!onSample || sampling) return;
    setSampling(true);
    try {
      const hex = await onSample();
      if (!mounted.current) return;
      const next = hex ? colorPickerParseHex(hex, value.a) : null;
      if (next) onChange(next);
    } catch { /* Cancelled or unavailable host sampler leaves the value unchanged. */ }
    finally { if (mounted.current) setSampling(false); }
  };
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

  const selectColor = (hex: string) => {
    const next = colorPickerParseHex(hex, value.a);
    if (next) onChange(next);
  };
  const collections = [
    ...(documentColors !== undefined ? [{ value: 'document', label: 'Document Colors' }] : []),
    ...(palette !== undefined ? [{ value: 'palette', label: 'Palette' }] : [])
  ];
  const collection = collections.some(option => option.value === paletteView) ? paletteView : collections[0]?.value;
  return <div className="ui-color-picker" data-ui-component="color-picker" data-suite-control="color-picker"
    data-variant={variant} role={variant === 'panel' ? 'group' : 'dialog'} aria-label="Color picker">
    <ColorArea hue={hsv.h} value={hsv} onChange={next => commitHsv({ ...next, h: hsv.h })} />
    <div className="ui-color-picker__hsl">
      <Slider label="Hue" value={hsl.h} min={0} max={360}
        format={(current) => `${Math.round(current)}°`} showResetMarker={false}
        trackBackground="linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)"
        onChange={(hue) => commitHsl({ ...hsl, h: hue })}
        onReset={() => commitHsl({ ...hsl, h: 0 })} />
      <Slider label="Saturation" value={hsl.s * 100} min={0} max={100}
        format={(current) => `${Math.round(current)}%`} showResetMarker={false}
        trackBackground={`linear-gradient(to right, hsl(${hsl.h} 0% ${hsl.l * 100}%), hsl(${hsl.h} 100% ${hsl.l * 100}%))`}
        onChange={(saturation) => commitHsl({ ...hsl, s: saturation / 100 })}
        onReset={() => commitHsl({ ...hsl, s: 0 })} />
      <Slider label="Luminosity" value={hsl.l * 100} min={0} max={100}
        format={(current) => `${Math.round(current)}%`} showResetMarker={false}
        trackBackground={`linear-gradient(to right, #000 0%, hsl(${hsl.h} 100% 50%) 50%, #fff 100%)`}
        onChange={(luminosity) => commitHsl({ ...hsl, l: luminosity / 100 })}
        onReset={() => commitHsl({ ...hsl, l: 0.5 })} />
    </div>
    {opacity !== undefined && onOpacityChange ? (
      <SliderField label="Opacity" ariaLabel="Color opacity" layout="stacked"
        value={opacity * 100} min={0} max={100} resetValue={100}
        format={current => `${Math.round(current)}%`} transparency
        trackBackground={`linear-gradient(to right, transparent, rgb(${byte(value.r)} ${byte(value.g)} ${byte(value.b)}))`}
        onChange={current => onOpacityChange(current / 100)} />
    ) : null}
    <div className="ui-color-picker__fields" data-sampler={Boolean(onSample)}>
      {onSample && <IconButton icon={sampleIcon ?? defaultSampler}
        aria-label="Sample color from screen" disabled={sampling}
        onClick={sample} />}
      <label><TextInput align="center" value={hex} aria-label="Hex color"
        onBlur={() => setHex(colorPickerHex(value))}
        onChange={event => {
          setHex(event.currentTarget.value);
          const parsed = colorPickerParseHex(event.currentTarget.value, value.a);
          if (parsed) onChange(parsed);
        }} /><span>#</span></label>
      {['R', 'G', 'B'].map((label, channel) => <label key={label}>
        <TextInput align="center" value={rgb[channel]} inputMode="numeric" aria-label={`${label} color channel`}
          onBlur={() => setRgb([byte(value.r), byte(value.g), byte(value.b)].map(String))}
          onChange={event => {
            const draft = event.currentTarget.value;
            setRgb(current => current.map((item, i) => i === channel ? draft : item));
            if (!/^\d{1,3}$/.test(draft) || Number(draft) > 255) return;
            const channels = [value.r, value.g, value.b];
            channels[channel] = Number(draft) / 255;
            onChange({ r: channels[0], g: channels[1], b: channels[2], a: value.a });
          }} /><span>{label}</span></label>)}
    </div>

    {collections.length > 0 && <section className="ui-color-picker__palette" aria-label="Image Palette">
      <SegmentedControl label="Color collection" value={collection!} onChange={setPaletteView} options={collections} />
      {collection === 'document' ? documentColorsStatus ? <p role="status">{documentColorsStatus}</p>
        : documentColors?.length ? <ColorSwatches label="Document" colors={documentColors} onSelect={selectColor} />
          : <p role="status">No visible colors</p>
        : <ColorSwatches colors={(palette ?? []).map(color => ({ color }))} onSelect={selectColor}
          onAdd={onPaletteChange ? () => {
            const color = colorPickerHex(value);
            onPaletteChange([color, ...(palette ?? []).filter(entry => entry.toUpperCase() !== color)].slice(0, 31));
          } : undefined}
          onRemove={onPaletteChange ? color => onPaletteChange((palette ?? []).filter(entry => entry !== color)) : undefined} />}
    </section>}
  </div>;
}
