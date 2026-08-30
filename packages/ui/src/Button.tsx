import type { ComponentPropsWithRef } from 'react';

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  intent?: 'normal' | 'destructive';
  fullWidth?: boolean;
}

/** A single native button. One height; native focus, keyboard and disabled behavior. */
export function Button({
  intent = 'normal',
  fullWidth = false,
  type = 'button',
  tabIndex = -1,
  className,
  ...props
}: ButtonProps) {
  return <button {...props} type={type} tabIndex={tabIndex}
    className={className ? `ui-button ${className}` : 'ui-button'}
    data-ui-component="button" data-suite-control="action-button" data-intent={intent}
    data-full-width={fullWidth || undefined}
  />;
}
