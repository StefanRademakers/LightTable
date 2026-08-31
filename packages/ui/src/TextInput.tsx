import { forwardRef, type InputHTMLAttributes } from 'react';

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  align?: 'left' | 'center' | 'right';
}

/** One native field, with the shared 28px control geometry. */
export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { className = '', tabIndex = -1, align = 'left', ...props }, ref
) {
  return <input {...props} ref={ref} tabIndex={tabIndex}
    className={`ui-text-input ${className}`} data-ui-component="text-input" data-align={align} />;
});
