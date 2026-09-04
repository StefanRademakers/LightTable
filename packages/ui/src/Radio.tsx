import { forwardRef, type InputHTMLAttributes } from 'react';
import { Text } from './Text';

export interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  /** Omit when an enclosing native label or aria-label already names the input. */
  label?: string;
  compact?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

/** Native radio semantics with the same compact geometry as Checkbox. */
export const Radio = forwardRef<HTMLInputElement, RadioProps>(function Radio({
  label, compact = false, onCheckedChange, onChange, className, tabIndex = -1, ...props
}, ref) {
  const input = <input {...props} ref={ref} type="radio" aria-label={props['aria-label'] ?? label}
    tabIndex={tabIndex} className={['ui-radio', className].filter(Boolean).join(' ')}
    data-ui-component="radio" data-suite-control="radio"
    onChange={event => {
      onChange?.(event);
      if (!event.defaultPrevented) onCheckedChange?.(event.currentTarget.checked);
    }} />;
  return compact || label === undefined ? input : <label className="ui-radio-field">
    {input}<Text variant="small">{label}</Text>
  </label>;
});
