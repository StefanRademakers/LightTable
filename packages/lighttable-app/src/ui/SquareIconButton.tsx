import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

interface SquareIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  active?: boolean;
  size?: 'regular' | 'compact';
  appearance?: 'control' | 'quiet';
}

export const SquareIconButton = forwardRef<HTMLButtonElement, SquareIconButtonProps>(function SquareIconButton({
  icon,
  active = false,
  size = 'regular',
  appearance = 'control',
  className,
  type = 'button',
  ...props
}, ref) {
  const rootClassName = [
    'square-icon-button',
    active ? 'square-icon-button--active' : '',
    size === 'compact' ? 'square-icon-button--compact' : '',
    appearance === 'quiet' ? 'square-icon-button--quiet' : '',
    className ?? ''
  ].filter(Boolean).join(' ');

  return (
    <button ref={ref} type={type} className={rootClassName} {...props}
      data-suite-control="square-icon-button"
      data-suite-variant={`${size}:${appearance}`}>
      {icon}
    </button>
  );
});
