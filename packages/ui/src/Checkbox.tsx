import { forwardRef, type InputHTMLAttributes } from 'react';
import { Text } from './Text';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  /** Omit when an enclosing native label or aria-label already names the input. */
  label?: string;
  compact?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

/** Native checkbox semantics; compact omits the visible label and its wrapper. */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox({ label, compact = false, onCheckedChange, onChange, className, tabIndex = -1, ...props }, ref) {
    const input = <input {...props} ref={ref} type="checkbox" aria-label={props['aria-label'] ?? label} tabIndex={tabIndex}
      className={['ui-checkbox', className].filter(Boolean).join(' ')}
      data-ui-component="checkbox" data-suite-control="panel-checkbox"
      onChange={event => {
        onChange?.(event);
        if (!event.defaultPrevented) onCheckedChange?.(event.currentTarget.checked);
      }} />;
    return compact || label === undefined ? input : <label className="ui-checkbox-field">
      {input}<Text variant="small">{label}</Text>
    </label>;
  }
);
