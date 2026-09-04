import { forwardRef, type ButtonHTMLAttributes } from 'react';

export interface ButtonBaseProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Classification remains visible until a product surface receives a canonical visual variant. */
  status?: 'approved' | 'provisional';
  'data-suite-control'?: string;
}

/**
 * Unstyled semantic button for app-specific surfaces such as tree rows and
 * canvas overlays. It owns behavior only; the consuming app owns appearance.
 */
export const ButtonBase = forwardRef<HTMLButtonElement, ButtonBaseProps>(function ButtonBase({
  type = 'button',
  tabIndex = -1,
  status = 'provisional',
  'data-suite-control': suiteControl = 'button-base',
  ...props
}, ref) {
  return <button ref={ref} type={type} tabIndex={tabIndex} data-ui-component="button-base" data-suite-control={suiteControl}
    data-suite-status={status} {...props} />;
});
