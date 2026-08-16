import type { ReactNode } from 'react';

export type SegmentedControlVariant = 'default' | 'low-attention';

export interface SegmentedControlOption<T extends string> {
  value: T;
  label?: string;
  icon?: ReactNode;
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
  className?: string;
}

interface SegmentedControlProps<T extends string> {
  options: Array<SegmentedControlOption<T>>;
  value: T | '';
  onChange: (value: T) => void;
  ariaLabel?: string;
  className?: string;
  variant?: SegmentedControlVariant;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
  variant = 'default'
}: SegmentedControlProps<T>) {
  const rootClass = [
    'segmented-control',
    variant === 'low-attention' ? 'segmented-control--low-attention' : '',
    className ?? ''
  ].filter(Boolean).join(' ');

  return (
    <div className={rootClass} role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => {
        const active = option.value === value;
        const buttonClass = [
          'segmented-control__button',
          active ? 'segmented-control__button--active' : '',
          option.className ?? ''
        ].filter(Boolean).join(' ');

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={option.ariaLabel ?? option.title ?? option.label}
            title={option.title}
            className={buttonClass}
            disabled={option.disabled}
            onClick={() => {
              if (!option.disabled && option.value !== value) onChange(option.value);
            }}
          >
            {option.icon ?? null}
            {option.label ? option.label : null}
          </button>
        );
      })}
    </div>
  );
}
