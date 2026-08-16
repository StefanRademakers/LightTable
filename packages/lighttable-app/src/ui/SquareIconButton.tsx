import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

interface SquareIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  active?: boolean;
}

export const SquareIconButton = forwardRef<HTMLButtonElement, SquareIconButtonProps>(function SquareIconButton({
  icon,
  active = false,
  className,
  type = 'button',
  ...props
}, ref) {
  const rootClassName = [
    'square-icon-button',
    active ? 'square-icon-button--active' : '',
    className ?? ''
  ].filter(Boolean).join(' ');

  return (
    <button ref={ref} type={type} className={rootClassName} {...props}
      data-suite-control="square-icon-button">
      {icon}
    </button>
  );
});
