import { forwardRef, type ButtonHTMLAttributes } from 'react';

interface ButtonBaseProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Transitional surfaces stay visible to the UI audit until assigned a canonical visual variant. */
  status?: 'approved' | 'provisional';
  'data-suite-control'?: string;
}

/**
 * Behavioral base for specialized buttons whose product surface is still
 * being classified. It deliberately adds no visual CSS of its own.
 */
export const ButtonBase = forwardRef<HTMLButtonElement, ButtonBaseProps>(function ButtonBase({
  type = 'button',
  status = 'provisional',
  'data-suite-control': _ignoredSuiteControl,
  ...props
}, ref) {
  return <button ref={ref} type={type} data-suite-control="button-base"
    data-suite-status={status} {...props} />;
});
