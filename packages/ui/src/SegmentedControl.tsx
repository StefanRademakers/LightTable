export interface SegmentOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SegmentedControlProps {
  label: string;
  options: readonly SegmentOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Opt into native tab navigation in dialogs. App chrome defaults to no tab stop. */
  tabIndex?: -1 | 0;
}

export function SegmentedControl({
  label, options, value, onChange, disabled = false, tabIndex = -1
}: SegmentedControlProps) {
  return <div className="ui-segmented" role="group" aria-label={label} data-ui-component="segmented-control">
    {options.map(option => <button key={option.value} type="button"
      className="ui-segmented__item" tabIndex={tabIndex}
      disabled={disabled || option.disabled} aria-pressed={value === option.value}
      onClick={() => { if (option.value !== value) onChange(option.value); }}
    >{option.label}</button>)}
  </div>;
}
