import { Children, Fragment, forwardRef, isValidElement, useId, useLayoutEffect, useRef, useState,
  type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { MaskIcon } from './MaskIcon';
import { sectionOpenIconUrl } from './icons';
import { SearchField } from './SearchField';
import { menuPosition } from './menuPosition';

export interface SelectOption {
  value: string;
  label: string;
  group?: string;
  disabled?: boolean;
  searchText?: string;
}
export interface SelectProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'value' | 'defaultValue' | 'onChange' | 'children'> {
  value?: string | number;
  defaultValue?: string | number;
  onValueChange?: (value: string) => void;
  options?: readonly SelectOption[];
  /** Native option/optgroup declarations may be reused without native popup styling. */
  children?: ReactNode;
  searchable?: boolean;
  searchPlaceholder?: string;
  placeholder?: string;
  placement?: 'auto' | 'above' | 'below';
}

function optionText(node: ReactNode): string {
  return Children.toArray(node).map(child => isValidElement<{ children?: ReactNode }>(child)
    ? optionText(child.props.children) : String(child)).join('');
}
function readOptions(children: ReactNode, group?: string, disabled = false): SelectOption[] {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement<{ children?: ReactNode; label?: string; value?: string | number; disabled?: boolean }>(child)) return [];
    if (child.type === Fragment) return readOptions(child.props.children, group, disabled);
    if (child.type === 'optgroup') return readOptions(child.props.children, child.props.label, disabled || child.props.disabled);
    if (child.type !== 'option') return [];
    const label = child.props.label ?? optionText(child.props.children);
    return [{ value: String(child.props.value ?? label), label, group, disabled: disabled || child.props.disabled }];
  });
}

export const Select = forwardRef<HTMLButtonElement, SelectProps>(function Select({
  value, defaultValue, onValueChange, options, children, searchable = false, searchPlaceholder = 'Search',
  placeholder, placement = 'auto', className, tabIndex = -1, disabled, onClick, onKeyDown, ...props
}, ref) {
  const anchor = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const entries = options ?? readOptions(children);
  const [localValue, setLocalValue] = useState(String(defaultValue ?? entries[0]?.value ?? ''));
  const selectedValue = String(value ?? localValue);
  const selected = entries.find(option => option.value === selectedValue);
  const id = useId();
  const choose = (next: string) => {
    setOpen(false);
    if (tabIndex >= 0) anchor.current?.focus({ preventScroll: true });
    else anchor.current?.blur();
    setLocalValue(next);
    if (next !== selectedValue) onValueChange?.(next);
  };
  return <>
    <button {...props} type="button" ref={element => {
      anchor.current = element;
      if (typeof ref === 'function') ref(element); else if (ref) ref.current = element;
    }} className={['ui-select', className].filter(Boolean).join(' ')}
      data-ui-component="select" data-suite-control="form-select" data-editor-native-tab-navigation disabled={disabled} tabIndex={tabIndex}
      role="combobox" aria-haspopup="listbox" aria-expanded={open && !disabled} aria-controls={open ? id : undefined}
      onClick={event => { onClick?.(event); if (!event.defaultPrevented) setOpen(!open); }}
      onKeyDown={event => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
          event.preventDefault(); event.stopPropagation(); setOpen(true);
        }
      }}>
      <span>{placeholder ?? selected?.label ?? ''}</span><MaskIcon src={sectionOpenIconUrl} className="ui-select__chevron" />
    </button>
    {open && !disabled ? <SelectPopup id={id} anchor={anchor} options={entries} selectedValue={selectedValue}
      searchable={searchable} searchPlaceholder={searchPlaceholder} placement={placement}
      onChoose={choose} onClose={restore => { setOpen(false); if (restore) anchor.current?.focus({ preventScroll: true }); }} /> : null}
  </>;
});

function SelectPopup({ id, anchor, options, selectedValue, searchable, searchPlaceholder, placement, onChoose, onClose }: {
  id: string; anchor: RefObject<HTMLButtonElement | null>; options: readonly SelectOption[]; selectedValue: string;
  searchable: boolean; searchPlaceholder: string; placement: 'auto' | 'above' | 'below';
  onChoose: (value: string) => void; onClose: (restoreFocus: boolean) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const filtered = options.filter(option => `${option.label} ${option.searchText ?? ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const [activeValue, setActiveValue] = useState(selectedValue);
  const active = filtered.findIndex(option => option.value === activeValue && !option.disabled);
  const activeIndex = active >= 0 ? active : filtered.findIndex(option => !option.disabled);
  const prefix = useRef({ text: '', time: 0 });
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 0 });
  useLayoutEffect(() => {
    const update = () => {
      if (!anchor.current || !root.current || !list.current) return;
      const bounds = anchor.current.getBoundingClientRect();
      const width = Math.min(Math.max(bounds.width, searchable ? 252 : 120), window.innerWidth - 16);
      const height = Math.min(list.current.scrollHeight + (searchable ? 34 : 0) + 12, 400);
      const next = { ...menuPosition(bounds, { width, height }, { width: window.innerWidth, height: window.innerHeight }, placement, 'start', 8, 2), width };
      next.maxHeight = Math.min(next.maxHeight, 400);
      setPosition(previous => Object.keys(next).every(key => previous[key as keyof typeof next] === next[key as keyof typeof next]) ? previous : next);
    };
    update();
    const observer = new ResizeObserver(update);
    if (anchor.current) observer.observe(anchor.current);
    if (list.current) observer.observe(list.current);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); };
  }, [anchor, placement, searchable, query, options.length]);
  useLayoutEffect(() => {
    if (position.width) (searchable ? search.current : list.current)?.focus({ preventScroll: true });
  }, [searchable, position.width > 0]);
  useLayoutEffect(() => {
    root.current?.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, position.width > 0]);
  useLayoutEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node) && !anchor.current?.contains(event.target as Node)) onClose(false);
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [anchor, onClose]);
  const navigate = (event: KeyboardEvent) => {
    event.stopPropagation();
    const enabled = filtered.map((option, index) => option.disabled ? -1 : index).filter(index => index >= 0);
    if (event.key === 'Escape') { event.preventDefault(); onClose(true); }
    else if (event.key === 'Tab') onClose(true);
    else if (event.key === 'Enter' || (!searchable && event.key === ' ')) {
      event.preventDefault(); if (activeIndex >= 0) onChoose(filtered[activeIndex]!.value);
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && enabled.length) {
      event.preventDefault();
      const index = enabled.indexOf(activeIndex);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length;
      setActiveValue(filtered[enabled[next]!]!.value);
    } else if (!searchable && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now();
      prefix.current = { text: now - prefix.current.time < 700 ? prefix.current.text + event.key : event.key, time: now };
      const match = filtered.find(option => !option.disabled && option.label.toLocaleLowerCase().startsWith(prefix.current.text.toLocaleLowerCase()));
      if (match) setActiveValue(match.value);
    }
  };
  return createPortal(<div ref={root} className="ui-select-popup" data-ui-component="select-popup"
    data-ui-theme={anchor.current?.closest<HTMLElement>('[data-ui-theme]')?.dataset.uiTheme}
    data-editor-native-tab-navigation data-editor-floating-control
    style={{ ...position, visibility: position.width ? 'visible' : 'hidden' }}
    onKeyDown={navigate} onKeyUp={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>
    {searchable ? <SearchField ref={search} value={query} placeholder={searchPlaceholder} aria-label={searchPlaceholder}
      onChange={event => setQuery(event.currentTarget.value)} onClear={() => setQuery('')}
      aria-controls={id} aria-activedescendant={activeIndex >= 0 ? `${id}-${activeIndex}` : undefined} /> : null}
    <div ref={list} id={id} className="ui-select-popup__list" role="listbox" tabIndex={-1}
      aria-label={anchor.current?.getAttribute('aria-label') ?? 'Options'}
      aria-activedescendant={activeIndex >= 0 ? `${id}-${activeIndex}` : undefined}>
      {filtered.map((option, index) => <Fragment key={`${option.value}-${index}`}>
        {option.group && option.group !== filtered[index - 1]?.group ? <div className="ui-select-popup__group">{option.group}</div> : null}
        <div id={`${id}-${index}`} role="option" aria-selected={option.value === selectedValue}
          aria-disabled={option.disabled || undefined} data-active={index === activeIndex || undefined}
          data-option-index={index} className="ui-select-popup__option" title={option.label}
          onPointerMove={() => { if (!option.disabled) setActiveValue(option.value); }}
          onClick={() => { if (!option.disabled) onChoose(option.value); }}>{option.label}</div>
      </Fragment>)}
      {!filtered.length ? <div className="ui-select-popup__empty">No matches</div> : null}
    </div>
  </div>, document.body);
}
