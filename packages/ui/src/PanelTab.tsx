import { forwardRef, type HTMLAttributes } from 'react';

export interface PanelTabProps extends HTMLAttributes<HTMLDivElement> {
  readonly selected?: boolean;
}

/** Visual panel-tab surface. Docking, ordering and activation stay host-owned. */
export const PanelTab = forwardRef<HTMLDivElement, PanelTabProps>(function PanelTab({
  selected = false,
  className,
  children,
  ...props
}, ref) {
  return <div ref={ref} {...props}
    className={['ui-panel-tab', className ?? ''].filter(Boolean).join(' ')}
    data-selected={selected || undefined}>{children}</div>;
});
