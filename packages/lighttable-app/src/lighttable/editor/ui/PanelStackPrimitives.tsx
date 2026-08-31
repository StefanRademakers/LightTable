import React, {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes
} from 'react';
import { lightTableIcon } from '../../../assets/icons';
import { ButtonBase } from '../../../ui/ButtonBase';

interface PanelStackRowProps extends HTMLAttributes<HTMLDivElement> {
  readonly selected?: boolean;
  readonly active?: boolean;
}

const stackRowClassName = (className: string | undefined, selected: boolean, active: boolean) => [
  'lighttable-panel-stack-row',
  selected ? 'lighttable-panel-stack-row--selected' : '',
  active ? 'lighttable-panel-stack-row--active' : '',
  className ?? ''
].filter(Boolean).join(' ');

export const PanelStackRow = forwardRef<HTMLDivElement, PanelStackRowProps>(function PanelStackRow({
  selected = false,
  active = false,
  className,
  ...props
}, ref) {
  return <div ref={ref} {...props} className={stackRowClassName(className, selected, active)} />;
});

interface PanelStackButtonRowProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly selected?: boolean;
  readonly active?: boolean;
}

export const PanelStackButtonRow = forwardRef<HTMLButtonElement, PanelStackButtonRowProps>(
  function PanelStackButtonRow({ selected = false, active = false, className, type = 'button', ...props }, ref) {
    return <ButtonBase ref={ref} type={type} {...props}
      className={stackRowClassName(className, selected, active)} />;
  }
);

export const PanelStackDisclosure: React.FC<{
  readonly expanded: boolean;
  readonly label: string;
  readonly className?: string;
  readonly onClick: React.MouseEventHandler<HTMLButtonElement>;
}> = ({ expanded, label, className, onClick }) => (
  <ButtonBase type="button"
    className={[
      'lighttable-panel-stack-disclosure',
      expanded ? '' : 'lighttable-panel-stack-disclosure--collapsed',
      className ?? ''
    ].filter(Boolean).join(' ')}
    onClick={onClick} aria-label={label} title={label}>
    <img src={lightTableIcon('chevron_layer.png')} alt="" aria-hidden="true" />
  </ButtonBase>
);

export const handlePanelCollectionNavigation = (
  event: React.KeyboardEvent<HTMLElement>,
  selector: string
): boolean => {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return false;
  const collection = event.currentTarget.closest<HTMLElement>('[data-panel-keyboard-collection]');
  if (!collection) return false;
  const rows = Array.from(collection.querySelectorAll<HTMLElement>(selector))
    .filter((row) => row.getAttribute('aria-disabled') !== 'true');
  const current = rows.indexOf(event.currentTarget);
  if (current < 0 || rows.length === 0) return false;
  const next = event.key === 'Home' ? 0
    : event.key === 'End' ? rows.length - 1
      : event.key === 'ArrowDown' ? Math.min(rows.length - 1, current + 1)
        : Math.max(0, current - 1);
  event.preventDefault();
  rows[next]?.focus();
  return true;
};
