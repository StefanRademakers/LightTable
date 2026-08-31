import type { ComponentPropsWithRef, ReactNode } from 'react';

export interface IconButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'children'> {
  icon: ReactNode;
  'aria-label': string;
}

export function IconButton({ icon, className = '', tabIndex = -1, type = 'button', ...props }: IconButtonProps) {
  return <button {...props} className={`ui-icon-button ${className}`} tabIndex={tabIndex}
    type={type} data-ui-component="icon-button">{icon}</button>;
}
