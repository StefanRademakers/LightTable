import React from 'react';
import { AdjustmentSlider } from '../lighttable/AdjustmentSlider';

export const OpacitySlider: React.FC<{
  value: number;
  color: string;
  onChange: (value: number) => void;
  label?: string;
  ariaLabel?: string;
}> = ({ value, color, onChange, label = 'Opacity', ariaLabel = 'Color opacity' }) => (
  <div className="opacity-slider">
    <AdjustmentSlider label={label} ariaLabel={ariaLabel} layout="inline"
      value={value * 100} min={0} max={100} resetValue={100}
      format={(current) => `${Math.round(current)}%`}
      trackBackground={`linear-gradient(to right, transparent, ${color}), linear-gradient(45deg, #8b8f92 25%, transparent 25%, transparent 75%, #8b8f92 75%), linear-gradient(45deg, #8b8f92 25%, #c5c8ca 25%, #c5c8ca 75%, #8b8f92 75%)`}
      onChange={(current) => onChange(current / 100)}
      onReset={() => onChange(1)} />
  </div>
);
