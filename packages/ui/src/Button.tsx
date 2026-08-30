import type { ComponentPropsWithRef } from 'react';

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  intent?: 'normal' | 'destructive';
}

/** A single native button. One height; native focus, keyboard and disabled behavior. */
export function Button({
  intent = 'normal',
  type = 'button',
  className,
  ...props
}: ButtonProps) {
  return <button {...props} type={type}
    className={className ? `ui-button ${className}` : 'ui-button'}
    data-ui-component="button" data-intent={intent}
  />;
}
