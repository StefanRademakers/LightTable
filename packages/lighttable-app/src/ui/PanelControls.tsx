import { Checkbox } from '@lighttable/ui';
import React from 'react';
import { AdjustmentSlider } from './AdjustmentSlider';
import { ColorSwatchField } from './ColorSwatchField';


export interface PanelColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

const channelHex = (value: number) =>
  Math.round(Math.min(1, Math.max(0, value)) * 255).toString(16).padStart(2, '0');

export const panelColorHex = (color: PanelColor) =>
  `#${channelHex(color.r)}${channelHex(color.g)}${channelHex(color.b)}`;

export const parsePanelHexColor = <T extends PanelColor>(value: string, alpha: number): T => ({
  r: Number.parseInt(value.slice(1, 3), 16) / 255,
  g: Number.parseInt(value.slice(3, 5), 16) / 255,
  b: Number.parseInt(value.slice(5, 7), 16) / 255,
  a: alpha
} as T);

export const PanelCheckboxField: React.FC<{
  label: string;
  checked: boolean;
  disabled?: boolean;
  compact?: boolean;
  onChange: (checked: boolean) => void;
}> = ({ label, checked, disabled = false, compact = false, onChange }) => (
  <Checkbox label={label} checked={checked} disabled={disabled} compact={compact} onCheckedChange={onChange} />
);

export const PanelColorSwatch = <T extends PanelColor>({
  label, value, inline = false, onChange,
  onInteractionStart, onInteractionCommit, onInteractionCancel
}: {
  label: string;
  value: T;
  inline?: boolean;
  onChange: (color: T) => void;
  onInteractionStart?: () => void;
  onInteractionCommit?: () => void;
  onInteractionCancel?: () => void;
}) => {
  const swatch = (
    <ColorSwatchField value={panelColorHex(value)} ariaLabel={label}
      onChange={(color) => onChange(parsePanelHexColor<T>(color, value.a))}
      onInteractionStart={onInteractionStart}
      onInteractionCommit={onInteractionCommit}
      onInteractionCancel={onInteractionCancel} />
  );
  return inline ? swatch : (
    <div className="lighttable-style-field">
      <span>{label}</span>
      {swatch}
    </div>
  );
};

export const PanelNumberSlider: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  resetValue?: number;
  onChange: (value: number) => void;
}> = ({ label, value, min, max, step = 1, suffix = '', resetValue = 0, onChange }) => (
  <AdjustmentSlider label={label} value={value} min={min} max={max} step={step}
    resetValue={resetValue}
    format={(current) => `${step < 1 ? current.toFixed(2) : Math.round(current)}${suffix}`}
    onChange={onChange} onReset={() => onChange(resetValue)} />
);

export { AngleControl as PanelAngleControl } from '@lighttable/ui';
