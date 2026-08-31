import { forwardRef, type ButtonHTMLAttributes } from 'react';

export interface SwitchControlProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
}

export const SwitchControl = forwardRef<HTMLButtonElement, SwitchControlProps>(
  function SwitchControl({ checked, onCheckedChange, label, className, tabIndex = -1, ...props }, ref) {
    return <button {...props} ref={ref} type="button" role="switch" aria-checked={checked}
      aria-label={label} title={label} tabIndex={tabIndex}
      className={['ui-switch', className].filter(Boolean).join(' ')}
      data-ui-component="switch" data-suite-control="switch-control"
      onClick={event => {
        props.onClick?.(event);
        if (!event.defaultPrevented) onCheckedChange(!checked);
      }}>
      <span className="ui-switch__thumb" aria-hidden="true" />
    </button>;
  }
);
