export interface SegmentOption<T extends string = string> {
  value: T;
  label: string;
  disabled?: boolean;
  title?: string;
}

export interface SegmentedControlProps<T extends string = string> {
  label: string;
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  /** Optional local theme scope when migrating controls into an existing app. */
  'data-ui-theme'?: 'dark' | 'light';
  disabled?: boolean;
  /** Opt into native tab navigation in dialogs. App chrome defaults to no tab stop. */
  tabIndex?: -1 | 0;
}

export function SegmentedControl<T extends string>({
  label, options, value, onChange, className, 'data-ui-theme': theme, disabled = false, tabIndex = -1
}: SegmentedControlProps<T>) {
  return <div className={['ui-segmented', className].filter(Boolean).join(' ')} role="group" aria-label={label}
    data-ui-theme={theme} data-ui-component="segmented-control" data-suite-control="segmented-control">
    {options.map(option => <button key={option.value} type="button"
      className="ui-segmented__item" tabIndex={tabIndex}
      disabled={disabled || option.disabled} aria-pressed={value === option.value}
      title={option.title ?? option.label}
      onClick={() => { if (option.value !== value) onChange(option.value); }}
    >{option.label}</button>)}
  </div>;
}
