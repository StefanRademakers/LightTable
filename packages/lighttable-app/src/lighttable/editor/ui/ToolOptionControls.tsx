import { Checkbox, NumberField, type NumberFieldProps, type SelectProps } from '@lighttable/ui';
import React from 'react';
import { ColorSwatchField } from '../../../ui/ColorSwatchField';
import { Select } from '@lighttable/ui';

export interface ToolOptionSelectProps
  extends Omit<SelectProps, 'children'> {
  readonly label: string;
  readonly children: React.ReactNode;
}

export const ToolOptionSelect: React.FC<ToolOptionSelectProps> = ({
  label,
  children,
  ...selectProps
}) => (
  <label className="lighttable-tool-options__field">
    <span>{label}</span>
    <Select {...selectProps}>{children}</Select>
  </label>
);

export interface ToolOptionColorProps {
  readonly label: string;
  readonly value: string;
  readonly status?: React.ReactNode;
  readonly ariaLabel?: string;
  readonly enabled?: boolean;
  /** Keeps the swatch interactive while paint is off; choosing a color can then enable it. */
  readonly allowChangeWhenOff?: boolean;
  readonly onEnabledChange?: (enabled: boolean) => void;
  readonly onChange: (value: string) => void;
  readonly onFocus?: () => void;
  readonly onBlur?: () => void;
  readonly onCancel?: () => void;
}

export const ToolOptionColor: React.FC<ToolOptionColorProps> = ({
  label,
  value,
  status,
  ariaLabel = label,
  enabled = true,
  allowChangeWhenOff = false,
  onEnabledChange,
  onChange,
  onFocus,
  onBlur,
  onCancel
}) => (
  <div className="lighttable-tool-options__color-field">
    <span>{label}</span>
    {onEnabledChange ? (
      <label
        className="lighttable-tool-options__toggle"
        title={enabled ? `Disable ${label.toLowerCase()}` : `Enable ${label.toLowerCase()}`}
      >
        <Checkbox

          checked={enabled}
          aria-label={`${ariaLabel}: enabled`}
          onChange={(event) => onEnabledChange(event.currentTarget.checked)}
        />
      </label>
    ) : null}
    <ColorSwatchField
      value={value}
      disabled={!enabled && !allowChangeWhenOff}
      ariaLabel={ariaLabel}
      size="compact"
      onInteractionStart={onFocus}
      onChange={onChange}
      onInteractionCommit={onBlur}
      onInteractionCancel={onCancel}
    />
    {status}
  </div>
);

export interface ToolOptionNumberProps
  extends Omit<NumberFieldProps, 'onValueChange'> {
  readonly label: string;
  readonly unit?: string;
  readonly onChange: (value: number) => void;
}

export const ToolOptionNumber: React.FC<ToolOptionNumberProps> = ({
  label,
  unit,
  onChange,
  ...inputProps
}) => (
  <label className="lighttable-tool-options__weight-field">
    <span>{label}</span>
    <NumberField
      {...inputProps}
      updateMode="input"
      onValueChange={onChange}
    />
    {unit ? <span>{unit}</span> : null}
  </label>
);
