import { Button, SegmentedControl, SelectField as PanelSelectField } from '@lighttable/ui';
import React, { useState } from 'react';

import { GradientField, type GradientFieldValue } from '@lighttable/ui';

import { CurvesEditor } from '../lighttable/CurvesEditor';
import {
  createDefaultCurves,
  type CurveChannel,
  type CurvesAdjustments,
  type ToneCurve
} from '../lighttable/curves';
import {
  PanelCheckboxField,
  PanelColorSwatch,
  PanelNumberSlider,
  type PanelColor
} from '../ui/PanelControls';

const BLACK_WHITE_GRADIENT: GradientFieldValue = {
  colorStops: [
    { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
    { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } }
  ],
  opacityStops: [
    { position: 0, opacity: 1 },
    { position: 1, opacity: 1 }
  ]
};

const AdjustmentBody = ({ children }: React.PropsWithChildren) => (
  <div className="lighttable-adjustment-dialog">{children}</div>
);

const Slider = ({
  label,
  initial = 0,
  min = -100,
  max = 100,
  step = 1,
  suffix = '',
  resetValue = 0
}: {
  label: string;
  initial?: number;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  resetValue?: number;
}) => {
  const [value, setValue] = useState(initial);
  return <PanelNumberSlider label={label} value={value} min={min} max={max}
    step={step} suffix={suffix} resetValue={resetValue} onChange={setValue} />;
};

const Select = ({
  label,
  initial,
  options
}: {
  label: string;
  initial: string;
  options: readonly string[];
}) => {
  const [value, setValue] = useState(initial);
  return <PanelSelectField label={label} value={value} onChange={setValue}
    options={options.map((option) => ({ value: option, label: option }))} />;
};

const Checkbox = ({ label, initial = false }: { label: string; initial?: boolean }) => {
  const [checked, setChecked] = useState(initial);
  return <PanelCheckboxField label={label} checked={checked} onChange={setChecked} />;
};

const Preset = () => <Select label="Preset" initial="Default" options={['Default', 'Custom']} />;

const Histogram = ({ marker = 52, output = false }: { marker?: number; output?: boolean }) => (
  <div className={`lighttable-adjustment-visual lighttable-adjustment-visual--histogram${output ? ' is-output' : ''}`}
    aria-hidden="true">
    <svg viewBox="0 0 280 112" preserveAspectRatio="none">
      <path d="M0 108 L8 105 16 101 24 92 32 98 40 80 48 72 56 77 64 55 72 45 80 49 88 31 96 38 104 20 112 30 120 15 128 26 136 42 144 34 152 50 160 43 168 61 176 52 184 70 192 64 200 79 208 73 216 91 224 85 232 98 240 94 248 104 256 100 264 107 280 108 Z" />
    </svg>
    <span className="lighttable-adjustment-visual__marker" style={{ left: `${marker}%` }} />
  </div>
);

const ColorRange = () => (
  <div className="lighttable-adjustment-color-range" aria-hidden="true">
    <span /><span />
    <i className="is-left" /><i className="is-right" />
  </div>
);

export const ColorAndVibranceAdjustmentDialog = () => <AdjustmentBody>
  <Slider label="Temperature" min={-100} max={100} />
  <Slider label="Tint" min={-100} max={100} />
  <Slider label="Vibrance" min={-100} max={100} initial={18} />
  <Slider label="Saturation" min={-100} max={100} />
</AdjustmentBody>;

export const BrightnessContrastAdjustmentDialog = () => <AdjustmentBody>
  <Preset />
  <Slider label="Brightness" />
  <Slider label="Contrast" />
  <Checkbox label="Use Legacy" />
</AdjustmentBody>;

export const LevelsAdjustmentDialog = () => <AdjustmentBody>
  <Preset />
  <Select label="Channel" initial="RGB" options={['RGB', 'Red', 'Green', 'Blue']} />
  <Histogram marker={48} />
  <div className="lighttable-adjustment-dialog__inline-values">
    <span>0</span><span>1.00</span><span>255</span>
  </div>
  <div className="lighttable-adjustment-dialog__eyedroppers" aria-label="Levels eyedroppers">
    <Button tabIndex={0}>Black</Button>
    <Button tabIndex={0}>Gray</Button>
    <Button tabIndex={0}>White</Button>
    <Button tabIndex={0}>Auto</Button>
  </div>
  <span className="lighttable-adjustment-dialog__minor-label">Output Levels</span>
  <div className="lighttable-adjustment-output-ramp" aria-hidden="true"><i /><i /></div>
</AdjustmentBody>;

export const CurvesAdjustmentDialog = () => {
  const [curves, setCurves] = useState<CurvesAdjustments>(() => createDefaultCurves());
  const [channel, setChannel] = useState<CurveChannel>('master');
  const changeCurve = (nextChannel: CurveChannel, points: ToneCurve) => {
    setCurves((current) => ({ ...current, [nextChannel]: points }));
  };
  return <AdjustmentBody>
    <Preset />
    <CurvesEditor curves={curves} channel={channel} histogram={null}
      onChannelChange={setChannel} onChange={changeCurve}
      onReset={(nextChannel) => setCurves((current) => ({
        ...current,
        [nextChannel]: [{ x: 0, y: 0 }, { x: 1, y: 1 }]
      }))}
      onInteractionStart={() => undefined} onInteractionEnd={() => undefined} />
  </AdjustmentBody>;
};

export const ExposureAdjustmentDialog = () => <AdjustmentBody>
  <Preset />
  <Slider label="Exposure" min={-5} max={5} step={0.01} suffix=" EV" />
  <Slider label="Offset" min={-0.5} max={0.5} step={0.001} />
  <Slider label="Gamma Correction" initial={1} min={0.01} max={9.99} step={0.01} resetValue={1} />
</AdjustmentBody>;

export const HueSaturationAdjustmentDialog = () => <AdjustmentBody>
  <Preset />
  <Select label="Range" initial="Master" options={['Master', 'Reds', 'Yellows', 'Greens', 'Cyans', 'Blues', 'Magentas']} />
  <Slider label="Hue" min={-180} max={180} suffix="deg" />
  <Slider label="Saturation" initial={12} />
  <Slider label="Lightness" />
  <ColorRange />
  <Checkbox label="Colorize" />
</AdjustmentBody>;

export const ColorBalanceAdjustmentDialog = () => {
  const [range, setRange] = useState('Midtones');
  return <AdjustmentBody>
    <SegmentedControl tabIndex={0} value={range} onChange={setRange} label="Tone range" options={[
      { value: 'Shadows', label: 'Shadows' },
      { value: 'Midtones', label: 'Midtones' },
      { value: 'Highlights', label: 'Highlights' }
    ]} />
    <Slider label="Cyan / Red" />
    <Slider label="Magenta / Green" />
    <Slider label="Yellow / Blue" />
    <Checkbox label="Preserve Luminosity" initial />
  </AdjustmentBody>;
};

export const BlackWhiteAdjustmentDialog = () => {
  const [tint, setTint] = useState<PanelColor>({ r: 0.82, g: 0.71, b: 0.52, a: 1 });
  return <AdjustmentBody>
    <Preset />
    <Slider label="Reds" initial={40} min={-200} max={300} />
    <Slider label="Yellows" initial={60} min={-200} max={300} />
    <Slider label="Greens" initial={40} min={-200} max={300} />
    <Slider label="Cyans" initial={60} min={-200} max={300} />
    <Slider label="Blues" initial={20} min={-200} max={300} />
    <Slider label="Magentas" initial={80} min={-200} max={300} />
    <div className="lighttable-adjustment-dialog__row"><Checkbox label="Tint" /><PanelColorSwatch label="Tint color" value={tint} inline onChange={setTint} /></div>
  </AdjustmentBody>;
};

export const PhotoFilterAdjustmentDialog = () => {
  const [color, setColor] = useState<PanelColor>({ r: 0.93, g: 0.55, b: 0.18, a: 1 });
  const [mode, setMode] = useState('Filter');
  return <AdjustmentBody>
    <SegmentedControl tabIndex={0} value={mode} onChange={setMode} label="Photo filter source" options={[
      { value: 'Filter', label: 'Filter' }, { value: 'Color', label: 'Color' }
    ]} />
    {mode === 'Filter'
      ? <Select label="Filter" initial="Warming Filter (85)" options={['Warming Filter (85)', 'Cooling Filter (80)', 'Deep Yellow', 'Underwater']} />
      : <PanelColorSwatch label="Color" value={color} onChange={setColor} />}
    <Slider label="Density" initial={25} min={1} max={100} suffix="%" />
    <Checkbox label="Preserve Luminosity" initial />
  </AdjustmentBody>;
};

export const ChannelMixerAdjustmentDialog = () => <AdjustmentBody>
  <Preset />
  <Select label="Output Channel" initial="Red" options={['Red', 'Green', 'Blue']} />
  <Slider label="Red" initial={100} min={-200} max={200} suffix="%" resetValue={100} />
  <Slider label="Green" min={-200} max={200} suffix="%" />
  <Slider label="Blue" min={-200} max={200} suffix="%" />
  <Slider label="Constant" min={-200} max={200} suffix="%" />
  <output className="lighttable-adjustment-dialog__total">Total: 100%</output>
  <Checkbox label="Monochrome" />
</AdjustmentBody>;

export const ColorLookupAdjustmentDialog = () => <AdjustmentBody>
  <Select label="3D LUT File" initial="Load 3D LUT..." options={['Load 3D LUT...', 'Crisp_Warm.look', 'Filmstock_50.3dl', 'Moonlight.3dl']} />
  <Select label="Abstract" initial="None" options={['None', 'Blue Tone', 'Sepia']} />
  <Select label="Device Link" initial="None" options={['None', 'Color Increase', 'Teal Orange']} />
</AdjustmentBody>;

export const SelectiveColorAdjustmentDialog = () => {
  const [method, setMethod] = useState('Relative');
  return <AdjustmentBody>
    <Preset />
    <Select label="Colors" initial="Reds" options={['Reds', 'Yellows', 'Greens', 'Cyans', 'Blues', 'Magentas', 'Whites', 'Neutrals', 'Blacks']} />
    <Slider label="Cyan" />
    <Slider label="Magenta" />
    <Slider label="Yellow" />
    <Slider label="Black" />
    <SegmentedControl tabIndex={0} value={method} onChange={setMethod} label="Selective Color method" options={[
      { value: 'Relative', label: 'Relative' }, { value: 'Absolute', label: 'Absolute' }
    ]} />
  </AdjustmentBody>;
};

export const InvertAdjustmentDialog = () => <AdjustmentBody>
  <p className="lighttable-adjustment-dialog__empty">Invert has no adjustment-specific properties. Use layer opacity and its mask to limit the effect.</p>
</AdjustmentBody>;

export const PosterizeAdjustmentDialog = () => <AdjustmentBody>
  <Slider label="Levels" initial={4} min={2} max={255} resetValue={4} />
</AdjustmentBody>;

export const ThresholdAdjustmentDialog = () => <AdjustmentBody>
  <Histogram marker={50} />
  <Slider label="Threshold Level" initial={128} min={1} max={255} resetValue={128} />
</AdjustmentBody>;

export const GradientMapAdjustmentDialog = () => {
  const [expanded, setExpanded] = useState(false);
  return <AdjustmentBody>
    <div className="lighttable-adjustment-dialog__gradient-row">
      <span>Gradient</span>
      <GradientField value={BLACK_WHITE_GRADIENT} ariaLabel="Gradient Map gradient"
        expanded={expanded} onClick={() => setExpanded((current) => !current)} />
    </div>
    <div className="lighttable-adjustment-dialog__row">
      <Checkbox label="Dither" initial />
      <Checkbox label="Reverse" />
    </div>
  </AdjustmentBody>;
};

export const ClarityDehazeAdjustmentDialog = () => <AdjustmentBody>
  <Slider label="Clarity" initial={10} />
  <Slider label="Dehaze" />
</AdjustmentBody>;

export const GrainAdjustmentDialog = () => <AdjustmentBody>
  <Slider label="Amount" initial={25} min={0} max={100} />
  <Slider label="Size" initial={25} min={0} max={100} />
  <Slider label="Roughness" initial={50} min={0} max={100} />
</AdjustmentBody>;

export const ADJUSTMENT_DIALOG_SPECIMENS = [
  { name: 'Color and Vibrance', Component: ColorAndVibranceAdjustmentDialog },
  { name: 'Brightness/Contrast', Component: BrightnessContrastAdjustmentDialog },
  { name: 'Levels', Component: LevelsAdjustmentDialog, shortcut: { windows: 'Ctrl+L', mac: 'Command+L' } },
  { name: 'Curves', Component: CurvesAdjustmentDialog, shortcut: { windows: 'Ctrl+M', mac: 'Command+M' } },
  { name: 'Exposure', Component: ExposureAdjustmentDialog },
  { name: 'Hue/Saturation', Component: HueSaturationAdjustmentDialog, shortcut: { windows: 'Ctrl+U', mac: 'Command+U' } },
  { name: 'Color Balance', Component: ColorBalanceAdjustmentDialog, shortcut: { windows: 'Ctrl+B', mac: 'Command+B' } },
  { name: 'Black & White', Component: BlackWhiteAdjustmentDialog, shortcut: { windows: 'Shift+Ctrl+Alt+B', mac: 'Shift+Command+Option+B' } },
  { name: 'Photo Filter', Component: PhotoFilterAdjustmentDialog },
  { name: 'Channel Mixer', Component: ChannelMixerAdjustmentDialog },
  { name: 'Color Lookup', Component: ColorLookupAdjustmentDialog },
  { name: 'Selective Color', Component: SelectiveColorAdjustmentDialog },
  { name: 'Invert', Component: InvertAdjustmentDialog, shortcut: { windows: 'Ctrl+I', mac: 'Command+I' } },
  { name: 'Posterize', Component: PosterizeAdjustmentDialog },
  { name: 'Threshold', Component: ThresholdAdjustmentDialog },
  { name: 'Gradient Map', Component: GradientMapAdjustmentDialog },
  { name: 'Clarity and Dehaze', Component: ClarityDehazeAdjustmentDialog },
  { name: 'Grain', Component: GrainAdjustmentDialog }
] as const;

export type PhotoshopShortcut = { readonly windows: string; readonly mac: string };

export const photoshopShortcutForCurrentPlatform = (shortcut: PhotoshopShortcut) => {
  const platform = typeof navigator === 'undefined'
    ? ''
    : `${navigator.platform} ${navigator.userAgent}`;
  return /Mac|iPhone|iPad|iPod/i.test(platform) ? shortcut.mac : shortcut.windows;
};
