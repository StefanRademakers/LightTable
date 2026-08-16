import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  size?: 'regular' | 'control' | 'compact';
  layout?: 'inline' | 'fill';
  'data-suite-control'?: string;
}

export function ActionButton({
  children,
  className,
  size = 'regular',
  layout = 'inline',
  type = 'button',
  'data-suite-control': _ignoredSuiteControl,
  ...props
}: ActionButtonProps) {
  const classes = [
    'action-button',
    size === 'control' ? 'action-button--control' : size === 'compact' ? 'action-button--compact' : '',
    layout === 'fill' ? 'action-button--fill' : '',
    className
  ]
    .filter(Boolean).join(' ');
  return (
    <button type={type} className={classes} data-suite-control="action-button" {...props}>
      {children}
    </button>
  );
}
