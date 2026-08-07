import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  size?: 'regular' | 'compact';
}

export function ActionButton({
  children, className, size = 'regular', type = 'button', ...props
}: ActionButtonProps) {
  const classes = ['action-button', size === 'compact' ? 'action-button--compact' : '', className]
    .filter(Boolean).join(' ');
  return (
    <button type={type} className={classes} {...props}>
      {children}
    </button>
  );
}
