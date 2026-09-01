import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { menuPosition, type MenuPosition } from './menuPosition';

export interface MenuOption<T extends string = string> {
  value: T;
  label: string;
  ariaLabel?: string;
  title?: string;
  description?: string;
  shortcut?: string;
  icon?: ReactNode;
  status?: 'connected' | 'disconnected';
  selected?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  separatorBefore?: boolean;
  onClick?: () => void;
  children?: readonly MenuOption<T>[];
  trailingAction?: {
    value: T;
    label: string;
    icon: ReactNode;
    disabled?: boolean;
    disabledReason?: string;
    onClick: () => void;
  };
}

export interface MenuProps<T extends string = string> {
  open: boolean;
  options: readonly MenuOption<T>[];
  onClose: () => void;
  label?: string;
  anchor?: RefObject<HTMLElement | null>;
  x?: number;
  y?: number;
  width?: number;
  placement?: 'auto' | 'above' | 'below';
  align?: 'start' | 'end';
  topInset?: number;
  gap?: number;
  /** Context menus consume the dismissing pointer; anchored panels may opt out. */
  modal?: boolean;
  'data-ui-theme'?: 'dark' | 'light';
  /** Host keyboard routers can identify the portalled interaction scope. */
  'data-editor-native-tab-navigation'?: boolean;
  onNavigate?: (direction: -1 | 1) => void;
}

export function Menu<T extends string>(props: MenuProps<T>) {
  return props.open && props.options.length ? <OpenMenu {...props} /> : null;
}

function OpenMenu<T extends string>(props: MenuProps<T>) {
  const owner = useId();
  const opener = useRef(props.anchor?.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  const close = (restoreFocus = true) => {
    // Restore before invoking a command, so a newly opened dialog keeps its focus.
    if (restoreFocus && opener.current?.isConnected) opener.current.focus({ preventScroll: true });
    props.onClose();
  };
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (props.anchor?.current?.contains(target)
        || target.closest?.(`[data-ui-menu-owner="${owner}"]`)) return;
      props.onClose();
      if (props.modal !== false && !target.closest?.('[role="menubar"]')) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [owner, props.anchor, props.onClose, props.modal]);
  const theme = props['data-ui-theme']
    ?? opener.current?.closest<HTMLElement>('[data-ui-theme]')?.dataset.uiTheme;
  return <MenuLevel {...props} owner={owner} theme={theme} close={close} autoFocus />;
}

interface MenuLevelProps<T extends string> extends MenuProps<T> {
  owner: string;
  theme?: string;
  close: (restoreFocus?: boolean) => void;
  autoFocus?: boolean;
  parent?: HTMLButtonElement;
  closeLevel?: () => void;
  keepOpen?: () => void;
}

function MenuLevel<T extends string>({ options, label = 'Context menu', anchor, x = 0, y = 0,
  width, placement = 'auto', align = 'start', topInset = 8, gap = 0,
  owner, theme, close, autoFocus, parent, closeLevel, keepOpen, onNavigate,
  'data-editor-native-tab-navigation': nativeKeys
}: MenuLevelProps<T>) {
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const [child, setChild] = useState<{ value: T; anchor: HTMLButtonElement; focus: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = () => { if (timer.current !== null) clearTimeout(timer.current); timer.current = null; };
  const retain = () => { clearTimer(); keepOpen?.(); };
  const hideChild = () => { clearTimer(); timer.current = setTimeout(() => setChild(null), 160); };
  useEffect(() => () => clearTimer(), []);

  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    const update = () => {
      const bounds = (parent ?? anchor?.current)?.getBoundingClientRect()
        ?? { left: x, right: x, top: y, bottom: y };
      const next = menuPosition(bounds,
        { width: element.getBoundingClientRect().width, height: element.scrollHeight + 2 },
        { width: window.innerWidth, height: window.innerHeight },
        parent ? 'submenu' : placement, align, topInset, gap);
      setPosition(current => current?.left === next.left && current.top === next.top && current.maxHeight === next.maxHeight ? current : next);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    if (parent ?? anchor?.current) observer.observe((parent ?? anchor?.current)!);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); };
  }, [anchor, parent, x, y, width, placement, align, topInset, gap, options]);

  useLayoutEffect(() => {
    if (!autoFocus || !position) return;
    const root = menu.current;
    (root?.querySelector<HTMLButtonElement>(':scope > .ui-menu__row > [aria-checked="true"]')
      ?? root?.querySelector<HTMLButtonElement>(':scope > .ui-menu__row > button'))?.focus({ preventScroll: true });
  }, [autoFocus, Boolean(position)]);

  const activeChild = child ? options.find(option => option.value === child.value && !option.disabled && option.children?.length) : undefined;
  return createPortal(<>
    <div ref={menu} role="menu" aria-label={label} className="ui-menu"
      data-ui-theme={theme} data-ui-component="menu" data-suite-control="context-menu"
      data-ui-menu-owner={owner} data-editor-native-tab-navigation={nativeKeys || undefined}
      style={{ left: position?.left ?? 0, top: position?.top ?? 0, maxHeight: position?.maxHeight,
        width, visibility: position ? undefined : 'hidden' }}
      onPointerEnter={retain} onPointerLeave={hideChild}
      onPointerDown={event => { event.preventDefault(); event.stopPropagation(); }}
      onClick={event => event.stopPropagation()}
      onKeyDown={event => {
        const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(':scope > .ui-menu__row > button')];
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const current = document.activeElement as HTMLButtonElement;
        const option = options.find(item => item.value === current?.dataset.menuValue);
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
        else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault(); event.stopPropagation(); retain(); setChild(null);
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          items[next]?.focus();
        } else if (event.key === 'ArrowRight') {
          event.preventDefault(); event.stopPropagation();
          if (option?.children?.length && !option.disabled) { retain(); setChild({ value: option.value, anchor: current, focus: true }); }
          else if (!parent) onNavigate?.(1);
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault(); event.stopPropagation();
          if (parent) { closeLevel?.(); parent.focus({ preventScroll: true }); }
          else onNavigate?.(-1);
        } else if (event.key === 'Tab') {
          event.preventDefault(); event.stopPropagation(); close();
        } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== ' ') {
          const ordered = [...items.slice(index + 1), ...items.slice(0, index + 1)];
          const match = ordered.find(item => (item.getAttribute('aria-label') ?? item.textContent ?? '').toLocaleLowerCase().startsWith(event.key.toLocaleLowerCase()));
          if (match) { event.preventDefault(); event.stopPropagation(); setChild(null); match.focus(); }
        }
      }}>
      {options.map(option => <Fragment key={option.value}>
        {option.separatorBefore ? <div className="ui-menu__separator" role="separator" /> : null}
        <div className="ui-menu__row" onPointerEnter={event => {
          retain();
          if (!option.disabled) {
            (event.currentTarget.firstElementChild as HTMLButtonElement | null)?.focus({ preventScroll: true });
          }
          setChild(option.children?.length && !option.disabled
            ? { value: option.value, anchor: event.currentTarget.firstElementChild as HTMLButtonElement, focus: false } : null);
        }}>
          <button type="button" className="ui-menu__item" tabIndex={-1}
            aria-label={option.ariaLabel}
            data-menu-value={option.value} data-selected={option.selected || undefined}
            role={option.selected === undefined ? 'menuitem' : 'menuitemradio'}
            aria-checked={option.selected} aria-disabled={option.disabled || undefined}
            aria-haspopup={option.children?.length ? 'menu' : undefined}
            aria-expanded={option.children?.length ? activeChild?.value === option.value : undefined}
            title={option.disabled ? option.disabledReason ?? 'Unavailable in the current context.' : option.title ?? option.label}
            onClick={event => {
              if (option.disabled) return;
              if (option.children?.length) { retain(); setChild({ value: option.value, anchor: event.currentTarget, focus: true }); }
              else { close(event.detail === 0); option.onClick?.(); }
            }}>
            {option.status ? <span className="ui-menu__status" data-status={option.status} aria-label={option.status === 'connected' ? 'Connected' : 'Not connected'} />
              : option.icon ? <span className="ui-menu__icon" aria-hidden="true">{option.icon}</span> : null}
            <span className="ui-menu__label">{option.label}{option.description ? <small>{option.description}</small> : null}</span>
            {option.shortcut ? <span className="ui-menu__shortcut" aria-hidden="true">{option.shortcut}</span> : null}
            {option.children?.length ? <svg className="ui-menu__chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m6 4 4 4-4 4" /></svg> : null}
          </button>
          {option.trailingAction ? <button type="button" className="ui-menu__action" role="menuitem" tabIndex={-1}
            aria-label={option.trailingAction.label} aria-disabled={option.trailingAction.disabled || undefined}
            title={option.trailingAction.disabled ? option.trailingAction.disabledReason ?? 'Unavailable in the current context.' : option.trailingAction.label}
            onClick={event => { if (!option.trailingAction?.disabled) {
              close(event.detail === 0); option.trailingAction?.onClick();
            } }}>
            <span className="ui-menu__icon" aria-hidden="true">{option.trailingAction.icon}</span>
          </button> : null}
        </div>
      </Fragment>)}
    </div>
    {activeChild && child ? <MenuLevel key={activeChild.value} open options={activeChild.children!} label={activeChild.label}
      owner={owner} theme={theme} parent={child.anchor} close={close} onClose={close}
      autoFocus={child.focus} closeLevel={() => setChild(null)} keepOpen={retain}
      topInset={topInset} data-editor-native-tab-navigation={nativeKeys} /> : null}
  </>, document.body);
}
