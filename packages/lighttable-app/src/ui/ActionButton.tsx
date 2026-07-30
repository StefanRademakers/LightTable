import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
}

export function ActionButton({ children, className, type = 'button', ...props }: ActionButtonProps) {
  const rootClassName = className ? `action-button ${className}` : 'action-button';
  return (
    <button type={type} className={rootClassName} {...props}>
      {children}
    </button>
  );
}
