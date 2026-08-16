import { forwardRef, type InputHTMLAttributes } from 'react';

interface FormInputProps extends InputHTMLAttributes<HTMLInputElement> {
  'data-suite-control'?: string;
}

export const FormInput = forwardRef<HTMLInputElement, FormInputProps>(function FormInput({
  className,
  'data-suite-control': suiteControl = 'form-input',
  ...props
}, ref) {
  const rootClassName = className ? `form-input ${className}` : 'form-input';
  return <input ref={ref} className={rootClassName} data-suite-control={suiteControl} {...props} />;
});
