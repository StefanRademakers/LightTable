import { forwardRef, type InputHTMLAttributes } from 'react';

export const FormInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function FormInput({ className, ...props }, ref) {
  const rootClassName = className ? `form-input ${className}` : 'form-input';
  return <input ref={ref} className={rootClassName} {...props} />;
});
