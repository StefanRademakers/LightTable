import { forwardRef, type ButtonHTMLAttributes } from 'react';

export interface SwitchControlProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
  readonly label: string;
}

/**
 * Shared compact on/off control for LightTable panels.
 *
 * The switch owns only interaction and accessibility. Callers retain the
 * domain meaning of the value (visibility, processing, scope rendering, …).
 */
export const SwitchControl = forwardRef<HTMLButtonElement, SwitchControlProps>(
  function SwitchControl({ checked, onCheckedChange, label, className, disabled, ...props }, ref) {
    const rootClassName = [
      'switch-control',
      checked ? 'switch-control--checked' : '',
      className ?? ''
    ].filter(Boolean).join(' ');

    return (
      <button
        {...props}
        ref={ref}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        title={label}
        disabled={disabled}
        className={rootClassName}
        onClick={(event) => {
          props.onClick?.(event);
          if (!event.defaultPrevented) onCheckedChange(!checked);
        }}
      >
        <span className="switch-control__thumb" aria-hidden="true" />
      </button>
    );
  }
);
