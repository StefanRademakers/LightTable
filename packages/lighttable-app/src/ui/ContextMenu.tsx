import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface ContextMenuOption<T extends string> {
  value: T;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  icon?: ReactNode;
  separatorBefore?: boolean;
  children?: Array<ContextMenuOption<T>>;
}

interface ContextMenuProps<T extends string> {
  open: boolean;
  x: number;
  y: number;
  onClose: () => void;
  options: Array<ContextMenuOption<T>>;
}

export function ContextMenu<T extends string>({
  open,
  x,
  y,
  onClose,
  options
}: ContextMenuProps<T>) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const closeSubmenuTimeoutRef = useRef<number | null>(null);
  const submenuRefs = useRef<Map<string, HTMLDivElement>>(new Map());
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
    const preferredTop = y + rect.height + margin > viewportHeight ? y - rect.height : y;
    const top = Math.max(margin, Math.min(preferredTop, viewportHeight - rect.height - margin));

    setPosition({ left, top });
    setSubmenuDirection(left + rect.width + 232 > viewportWidth - margin ? 'left' : 'right');
  }, [open, options.length, x, y]);

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
        isSubmenu ? 'context-menu--submenu' : '',
        isSubmenu && submenuDirection === 'left' ? 'context-menu--submenu-left' : '',
        isSubmenu && submenuDirection === 'right' ? 'context-menu--submenu-right' : ''
      ].filter(Boolean).join(' ')}
      style={isSubmenu ? { top: `${-8 + submenuOffset}px` } : { left: position.left, top: position.top }}
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
                hasChildren ? 'context-menu__item--has-children' : ''
              ].filter(Boolean).join(' ')}
              disabled={option.disabled}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (hasChildren) return;
                onClose();
                option.onClick?.();
              }}
            >
              {option.icon ? <span className="context-menu__item-icon">{option.icon}</span> : null}
              <span className="context-menu__item-label">{option.label}</span>
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
