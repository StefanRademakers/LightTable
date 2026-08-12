import React from 'react';
import { lightTableIcon } from '../assets/icons';

export interface PanelSectionProps {
  readonly label: string;
  readonly expanded: boolean;
  readonly onExpandedChange: (expanded: boolean) => void;
  readonly actions?: React.ReactNode;
  readonly className?: string;
  readonly title?: string;
  readonly onTogglePointerDown?: React.PointerEventHandler<HTMLButtonElement>;
  readonly onToggleClick?: React.MouseEventHandler<HTMLButtonElement>;
  readonly children: React.ReactNode;
}

/** The canonical collapsible section surface for editor side panels. */
export const PanelSection = ({
  label,
  expanded,
  onExpandedChange,
  actions,
  className,
  title = label,
  onTogglePointerDown,
  onToggleClick,
  children
}: PanelSectionProps) => (
  <section className={`lighttable-group${className ? ` ${className}` : ''}`}>
    <div className="lighttable-group__header">
      <button
        type="button"
        className="lighttable-group__toggle"
        aria-expanded={expanded}
        title={title}
        onPointerDown={onTogglePointerDown}
        onClick={onToggleClick ?? (() => onExpandedChange(!expanded))}
      >
        <img src={lightTableIcon(expanded ? 'area_open.png' : 'area_closed.png')} alt="" aria-hidden="true" />
        <strong>{label}</strong>
      </button>
      {actions ? <div className="lighttable-group__actions">{actions}</div> : null}
    </div>
    {expanded ? <div className="lighttable-group__controls">{children}</div> : null}
  </section>
);
