import type { ComponentPropsWithRef, ReactNode } from 'react';

export interface IconButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'children'> {
  icon: ReactNode;
  'aria-label': string;
  variant?: 'standard' | 'quiet';
  size?: 'regular' | 'compact';
  active?: boolean;
}

export function IconButton({
  icon,
  variant = 'standard',
  size = 'regular',
  active,
  className = '',
  tabIndex = -1,
  type = 'button',
  ...props
}: IconButtonProps) {
  return <button {...props} className={`ui-icon-button ${className}`} tabIndex={tabIndex}
    type={type} data-ui-component="icon-button" data-variant={variant} data-size={size}
    data-active={active || undefined} aria-pressed={active}>{icon}</button>;
}
