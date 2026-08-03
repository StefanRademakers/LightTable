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
        <input
          type="checkbox"
          checked={enabled}
          aria-label={`${ariaLabel}: enabled`}
          onChange={(event) => onEnabledChange(event.currentTarget.checked)}
        />
      </label>
    ) : null}
    <input
      type="color"
      value={value}
      disabled={!enabled && !allowChangeWhenOff}
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
  </div>
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
