import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEventHandler,
  type ReactNode
} from 'react';

export interface TreeRowProps extends HTMLAttributes<HTMLDivElement> {
  selected?: boolean;
  active?: boolean;
}

const treeRowClassName = (className: string | undefined) =>
  ['ui-tree-row', className].filter(Boolean).join(' ');

/** Shared visual row for hierarchical panel content; domain columns remain consumer-owned. */
export const TreeRow = forwardRef<HTMLDivElement, TreeRowProps>(function TreeRow({
  selected = false,
  active = false,
  className,
  ...props
}, ref) {
  return <div ref={ref} {...props} className={treeRowClassName(className)}
    data-ui-component="tree-row" data-suite-control="tree-row"
    data-selected={selected || undefined} data-active={active || undefined} />;
});

export interface TreeButtonRowProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  active?: boolean;
}

/** Native-button variant used by flat selectable collections such as History. */
export const TreeButtonRow = forwardRef<HTMLButtonElement, TreeButtonRowProps>(
  function TreeButtonRow({ selected = false, active = false, className, type = 'button', ...props }, ref) {
    return <button ref={ref} type={type} {...props} className={treeRowClassName(className)}
      data-ui-component="tree-row" data-suite-control="tree-row"
      data-selected={selected || undefined} data-active={active || undefined} />;
  }
);

export interface TreeDisclosureProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  expanded: boolean;
  label: string;
  icon: ReactNode;
  onClick: MouseEventHandler<HTMLButtonElement>;
}

/** Disclosure behavior and geometry; the host supplies its existing icon asset. */
export function TreeDisclosure({ expanded, label, icon, className, type = 'button', ...props }: TreeDisclosureProps) {
  return <button {...props} type={type}
    className={['ui-tree-disclosure', className].filter(Boolean).join(' ')}
    data-ui-component="tree-disclosure" data-expanded={expanded || undefined}
    aria-expanded={expanded} aria-label={label} title={props.title ?? label}>
    <span className="ui-tree-disclosure__icon" aria-hidden="true">{icon}</span>
  </button>;
}

export function handleTreeCollectionNavigation(
  event: KeyboardEvent<HTMLElement>,
  selector: string
): boolean {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return false;
  const collection = event.currentTarget.closest<HTMLElement>('[data-tree-keyboard-collection]');
  if (!collection) return false;
  const rows = Array.from(collection.querySelectorAll<HTMLElement>(selector))
    .filter(row => row.getAttribute('aria-disabled') !== 'true' && !row.hasAttribute('disabled'));
  const current = rows.indexOf(event.currentTarget);
  if (current < 0 || rows.length === 0) return false;
  const next = event.key === 'Home' ? 0
    : event.key === 'End' ? rows.length - 1
      : event.key === 'ArrowDown' ? Math.min(rows.length - 1, current + 1)
        : Math.max(0, current - 1);
  event.preventDefault();
  rows[next]?.focus();
  return true;
}
