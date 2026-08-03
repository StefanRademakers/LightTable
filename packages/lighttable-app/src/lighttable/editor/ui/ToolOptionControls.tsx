import React from 'react';

export interface ToolOptionSelectProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
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
    <select {...selectProps}>{children}</select>
  </label>
);

export interface ToolOptionColorProps {
  readonly label: string;
  readonly value: string;
  readonly status?: React.ReactNode;
  readonly ariaLabel?: string;
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
  onChange,
  onFocus,
  onBlur,
  onCancel
}) => (
  <label className="lighttable-tool-options__color-field">
    <span>{label}</span>
    <input
      type="color"
      value={value}
      aria-label={ariaLabel}
      onFocus={onFocus}
      onChange={(event) => onChange(event.currentTarget.value)}
      onBlur={onBlur}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !onCancel) return;
        event.preventDefault();
        onCancel();
        event.currentTarget.blur();
      }}
    />
    {status}
  </label>
);

export interface ToolOptionNumberProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'type'> {
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
    <input
      {...inputProps}
      type="number"
      onChange={(event) => onChange(Number(event.currentTarget.value))}
    />
    {unit ? <span>{unit}</span> : null}
  </label>
);
