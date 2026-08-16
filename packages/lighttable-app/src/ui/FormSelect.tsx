import { forwardRef, type SelectHTMLAttributes } from 'react';

interface FormSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  'data-suite-control'?: string;
}

/** Canonical native select surface for dialogs, toolbars and compact forms. */
export const FormSelect = forwardRef<HTMLSelectElement, FormSelectProps>(function FormSelect({
  className,
  'data-suite-control': _ignoredSuiteControl,
  ...props
}, ref) {
  const rootClassName = className ? `form-input ${className}` : 'form-input';
  return <select ref={ref} className={rootClassName} data-suite-control="form-select" {...props} />;
});
