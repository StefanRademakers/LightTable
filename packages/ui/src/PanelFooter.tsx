import { forwardRef, type HTMLAttributes } from 'react';

export interface PanelFooterProps extends HTMLAttributes<HTMLElement> {}

/** Shared panel action bar. Button meaning and ordering remain feature-owned. */
export const PanelFooter = forwardRef<HTMLElement, PanelFooterProps>(function PanelFooter({
  className,
  children,
  ...props
}, ref) {
  return <footer ref={ref} {...props}
    className={['ui-panel-footer', className ?? ''].filter(Boolean).join(' ')}>{children}</footer>;
});
