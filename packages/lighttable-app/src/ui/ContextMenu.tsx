import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface ContextMenuOption<T extends string> {
  value: T;
  label: string;
  description?: string;
  shortcut?: string;
  onClick?: () => void;
  disabled?: boolean;
  disabledReason?: string;
  icon?: ReactNode;
  status?: 'connected' | 'disconnected';
  selected?: boolean;
  separatorBefore?: boolean;
  children?: Array<ContextMenuOption<T>>;
}

interface ContextMenuProps<T extends string> {
  open: boolean;
  x: number;
  y: number;
  onClose: () => void;
  options: Array<ContextMenuOption<T>>;
  placement?: 'auto' | 'above' | 'below';
  className?: string;
  width?: number;
}

export function ContextMenu<T extends string>({
  open,
  x,
  y,
  onClose,
  options,
  placement = 'auto',
  className,
  width
}: ContextMenuProps<T>) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const closeSubmenuTimeoutRef = useRef<number | null>(null);
  const submenuRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  const [submenuDirection, setSubmenuDirection] = useState<'left' | 'right'>('right');
  const [openSubmenuPath, setOpenSubmenuPath] = useState<string[]>([]);
  const [submenuOffsets, setSubmenuOffsets] = useState<Record<string, number>>({});

  const clearCloseSubmenuTimeout = () => {
    if (closeSubmenuTimeoutRef.current === null) return;
    window.clearTimeout(closeSubmenuTimeoutRef.current);
    closeSubmenuTimeoutRef.current = null;
  };

  const scheduleSubmenuClose = (depth: number) => {
    clearCloseSubmenuTimeout();
    closeSubmenuTimeoutRef.current = window.setTimeout(() => {
      setOpenSubmenuPath((current) => current.slice(0, depth));
      closeSubmenuTimeoutRef.current = null;
    }, 160);
  };

  const openSubmenu = (path: string[]) => {
    clearCloseSubmenuTimeout();
    setOpenSubmenuPath(path);
  };

  useEffect(() => {
    if (open) return;
    clearCloseSubmenuTimeout();
    setOpenSubmenuPath([]);
    setSubmenuOffsets({});
  }, [open]);

  useEffect(() => {
    if (open) {
      restoreFocusRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      const frame = window.requestAnimationFrame(() => {
        const menu = menuRef.current;
        (menu?.querySelector<HTMLElement>(':scope > .context-menu__item-wrap > .context-menu__item[aria-checked="true"]')
          ?? menu?.querySelector<HTMLElement>(':scope > .context-menu__item-wrap > .context-menu__item'))?.focus();
      });
      return () => window.cancelAnimationFrame(frame);
    }
    const restore = restoreFocusRef.current;
    restoreFocusRef.current = null;
    if (restore?.isConnected) restore.focus();
    return undefined;
  }, [open, x, y]);

  useEffect(() => () => clearCloseSubmenuTimeout(), []);

  useLayoutEffect(() => {
    if (!open) return;

    const margin = 12;
    const nextOffsets: Record<string, number> = {};

    for (const [pathKey, submenu] of submenuRefs.current.entries()) {
      const rect = submenu.getBoundingClientRect();
      const overflowBottom = rect.bottom - (window.innerHeight - margin);
      const overflowTop = margin - rect.top;

      if (overflowBottom > 0) {
        nextOffsets[pathKey] = -overflowBottom;
      } else if (overflowTop > 0) {
        nextOffsets[pathKey] = overflowTop;
      }
    }

    setSubmenuOffsets((current) => {
      const currentKeys = Object.keys(current);
      const nextKeys = Object.keys(nextOffsets);
      if (currentKeys.length === nextKeys.length && nextKeys.every((key) => current[key] === nextOffsets[key])) {
        return current;
      }
      return nextOffsets;
    });
  }, [open, openSubmenuPath, options.length, position.left, position.top, submenuDirection]);

  useLayoutEffect(() => {
    if (!open) return;

    const menu = menuRef.current;
    if (!menu) {
      setPosition({ left: x, top: y });
      return;
    }

    const margin = 12;
    const rect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const left = Math.max(margin, Math.min(x, viewportWidth - rect.width - margin));
    const preferredTop = placement === 'above'
      ? y - rect.height
      : placement === 'below'
        ? y
        : y + rect.height + margin > viewportHeight ? y - rect.height : y;
    const top = Math.max(margin, Math.min(preferredTop, viewportHeight - rect.height - margin));

    setPosition({ left, top });
    setSubmenuDirection(left + rect.width + 232 > viewportWidth - margin ? 'left' : 'right');
  }, [open, options.length, placement, x, y]);

  if (!open || !options.length) return null;

  const renderOptions = (
    menuOptions: Array<ContextMenuOption<T>>,
    isSubmenu = false,
    parentPath: string[] = []
  ) => {
    const submenuPathKey = parentPath.join('/');
    const submenuOffset = submenuOffsets[submenuPathKey] ?? 0;

    return (
    <div
      ref={(node) => {
        if (!isSubmenu) {
          menuRef.current = node;
          return;
        }
        if (!submenuPathKey) return;
        if (node) {
          submenuRefs.current.set(submenuPathKey, node);
          return;
        }
        submenuRefs.current.delete(submenuPathKey);
      }}
      className={[
        'context-menu',
        !isSubmenu ? className ?? '' : '',
        isSubmenu ? 'context-menu--submenu' : '',
        isSubmenu && submenuDirection === 'left' ? 'context-menu--submenu-left' : '',
        isSubmenu && submenuDirection === 'right' ? 'context-menu--submenu-right' : ''
      ].filter(Boolean).join(' ')}
      role="menu"
      data-editor-native-tab-navigation
      aria-label={isSubmenu ? 'Submenu' : 'Context menu'}
      style={isSubmenu
        ? { top: `${-8 + submenuOffset}px` }
        : { left: position.left, top: position.top, ...(width ? { width, minWidth: width } : {}) }}
      onMouseEnter={() => {
        if (!isSubmenu) return;
        clearCloseSubmenuTimeout();
      }}
      onMouseLeave={() => {
        if (!isSubmenu) return;
        scheduleSubmenuClose(Math.max(0, parentPath.length - 1));
      }}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(
          ':scope > .context-menu__item-wrap > .context-menu__item'
        )];
        const index = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement));
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
          return;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
          event.preventDefault();
          const next = event.key === 'Home' ? 0
            : event.key === 'End' ? items.length - 1
              : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          items[next]?.focus();
          return;
        }
        if (event.key === 'ArrowRight') {
          const wrap = (document.activeElement as HTMLElement | null)?.closest('.context-menu__item-wrap');
          const submenu = wrap?.querySelector<HTMLElement>(':scope > .context-menu--submenu');
          submenu?.querySelector<HTMLElement>(':scope > .context-menu__item-wrap > .context-menu__item')?.focus();
          return;
        }
        if (event.key === 'ArrowLeft' && isSubmenu) {
          event.preventDefault();
          event.currentTarget.parentElement?.querySelector<HTMLElement>(':scope > .context-menu__item')?.focus();
        }
      }}
    >
      {menuOptions.map((option, index) => {
        const hasChildren = Boolean(option.children?.length);
        const itemPath = [...parentPath, `${index}:${option.value}`];
        const submenuOpen = hasChildren && itemPath.every((segment, pathIndex) => openSubmenuPath[pathIndex] === segment);
        return (
          <div
            key={option.value}
            className={[
              'context-menu__item-wrap',
              hasChildren ? 'context-menu__item-wrap--has-children' : '',
              submenuOpen ? 'context-menu__item-wrap--submenu-open' : ''
            ].filter(Boolean).join(' ')}
            onMouseEnter={() => {
              if (hasChildren) {
                openSubmenu(itemPath);
                return;
              }
              clearCloseSubmenuTimeout();
              setOpenSubmenuPath(parentPath);
            }}
            onMouseLeave={() => {
              if (!hasChildren) return;
              scheduleSubmenuClose(parentPath.length);
            }}
          >
            {option.separatorBefore ? <div className="context-menu__separator" aria-hidden="true" /> : null}
            <button
              type="button"
              className={[
                'context-menu__item',
                option.selected ? 'context-menu__item--selected' : '',
                hasChildren ? 'context-menu__item--has-children' : '',
                option.disabled ? 'context-menu__item--disabled' : ''
              ].filter(Boolean).join(' ')}
              role={option.selected === undefined ? 'menuitem' : 'menuitemradio'}
              aria-disabled={option.disabled || undefined}
              aria-checked={option.selected || undefined}
              aria-haspopup={hasChildren ? 'menu' : undefined}
              aria-expanded={hasChildren ? submenuOpen : undefined}
              title={option.disabled ? option.disabledReason ?? 'Unavailable in the current context.' : undefined}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (hasChildren || option.disabled) return;
                onClose();
                option.onClick?.();
              }}
            >
              {option.status ? (
                <span
                  className={`context-menu__status context-menu__status--${option.status}`}
                  aria-label={option.status === 'connected' ? 'Connected' : 'Not connected'}
                  title={option.status === 'connected' ? 'Connected' : 'Not connected'}
                />
              ) : option.icon ? <span className="context-menu__item-icon">{option.icon}</span> : null}
              <span className="context-menu__item-label">
                <span>{option.label}</span>
                {option.description ? <small>{option.description}</small> : null}
              </span>
              {option.shortcut ? (
                <span className="context-menu__item-shortcut" aria-hidden="true">
                  {option.shortcut}
                </span>
              ) : null}
              {hasChildren ? <span className="context-menu__submenu-indicator" aria-hidden="true">›</span> : null}
            </button>
            {hasChildren ? renderOptions(option.children ?? [], true, itemPath) : null}
          </div>
        );
      })}
    </div>
    );
  };

  return createPortal(
    <>
      <div className="context-menu-backdrop" onClick={onClose} />
      {renderOptions(options)}
    </>,
    document.body
  );
}
