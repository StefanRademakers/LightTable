import { useId, useState, type MouseEventHandler, type PointerEventHandler, type ReactNode } from 'react';
import { Text } from './Text';
import { MaskIcon } from './MaskIcon';
import { sectionOpenIconUrl, sectionClosedIconUrl } from './icons';

export interface PanelSectionHeaderProps {
  label: string;
  actions?: ReactNode;
  title?: string;
  /** Omit for a static header. */
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  controlsId?: string;
  tabIndex?: number;
  onTogglePointerDown?: PointerEventHandler<HTMLButtonElement>;
  /** Consumer gestures (e.g. Shift-reset) can preventDefault to suppress toggling. */
  onToggleClick?: MouseEventHandler<HTMLButtonElement>;
}

/** Shared header for both standalone titles and collapsible sections. */
export function PanelSectionHeader({ label, actions, title = label, expanded,
  onExpandedChange, controlsId, tabIndex = -1, onTogglePointerDown, onToggleClick }: PanelSectionHeaderProps) {
  return <div className="ui-panel-section__header" data-ui-component="panel-section-header">
    {expanded === undefined
      ? <Text weight="bold" className="ui-panel-section__label" title={title}>{label}</Text>
      : <button type="button" className="ui-panel-section__toggle" title={title}
          tabIndex={tabIndex} aria-expanded={expanded} aria-controls={controlsId}
          onPointerDown={onTogglePointerDown} onClick={(event) => {
            onToggleClick?.(event);
            if (!event.defaultPrevented) onExpandedChange?.(!expanded);
          }}>
          <MaskIcon className="ui-panel-section__chevron" src={expanded ? sectionOpenIconUrl : sectionClosedIconUrl} />
          <Text weight="bold" className="ui-panel-section__label">{label}</Text>
        </button>}
    {actions ? <div className="ui-panel-section__actions">{actions}</div> : null}
  </div>;
}

export interface PanelSectionProps extends PanelSectionHeaderProps {
  children?: ReactNode;
  defaultExpanded?: boolean;
  collapsible?: boolean;
  /** Hidden canvas/DOM bindings stay alive. Default: unmount collapsed content. */
  keepMounted?: boolean;
  /** Primary controls that remain visible when only advanced content collapses. */
  alwaysVisible?: ReactNode;
  padding?: 'normal' | 'none';
  /** Inline disclosure on the surrounding content surface, without extra indentation. */
  variant?: 'panel' | 'disclosure';
  className?: string;
  contentClassName?: string;
}

export function PanelSection({ children, expanded: controlledExpanded, defaultExpanded = false,
  onExpandedChange, collapsible = true, keepMounted = false, alwaysVisible,
  padding = 'normal', variant = 'panel', className = '', contentClassName = '', ...header }: PanelSectionProps) {
  const [localExpanded, setLocalExpanded] = useState(defaultExpanded);
  const id = useId();
  const expanded = !collapsible || (controlledExpanded ?? localExpanded);
  return <section className={`ui-panel-section ${className}`} data-ui-component="panel-section"
    data-suite-control="panel-section" data-variant={variant}>
    <PanelSectionHeader {...header} controlsId={id} expanded={collapsible ? expanded : undefined}
      onExpandedChange={(next) => {
        if (controlledExpanded === undefined) setLocalExpanded(next);
        onExpandedChange?.(next);
      }} />
    {alwaysVisible != null ? <div className="ui-panel-section__body" data-padding={padding}>{alwaysVisible}</div> : null}
    {expanded || keepMounted ? <div id={id} hidden={!expanded}
      className={`ui-panel-section__body ${contentClassName}`} data-padding={padding}>{children}</div> : null}
  </section>;
}
