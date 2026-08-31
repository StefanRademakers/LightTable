import React from 'react';
import { SliderField } from '@lighttable/ui';

export const OpacitySlider: React.FC<{
  value: number;
  color: string;
  onChange: (value: number) => void;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
  label?: string;
  ariaLabel?: string;
}> = ({
  value, color, onChange, onInteractionStart, onInteractionEnd,
  label = 'Opacity', ariaLabel = 'Color opacity'
}) => (
  <div className="opacity-slider" data-suite-control="opacity-slider">
    <SliderField label={label} ariaLabel={ariaLabel} layout="inline"
      value={value * 100} min={0} max={100} resetValue={100}
      format={(current) => `${Math.round(current)}%`}
      transparency trackBackground={`linear-gradient(to right, transparent, ${color})`}
      onChange={(current) => onChange(current / 100)}
      onReset={() => onChange(1)}
      onInteractionStart={onInteractionStart}
      onInteractionEnd={onInteractionEnd} />
  </div>
);
