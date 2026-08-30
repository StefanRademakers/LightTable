import { useRef, useState } from 'react';
import { Menu, type MenuOption } from './Menu';

export interface MenuBarItem<T extends string = string> { value: T; label: string; disabled?: boolean }
export interface MenuBarProps<T extends string = string> {
  items: readonly MenuBarItem<T>[];
  optionsFor: (value: T) => readonly MenuOption[];
  label?: string;
  'data-editor-native-tab-navigation'?: boolean;
}

/** File/Edit/View-style application menu; the host supplies commands, not styling. */
export function MenuBar<T extends string>({ items, optionsFor, label = 'Application menu',
  'data-editor-native-tab-navigation': nativeKeys }: MenuBarProps<T>) {
  const [active, setActive] = useState<T | null>(null);
  const buttons = useRef(new Map<T, HTMLButtonElement>());
  const anchor = useRef<HTMLElement | null>(null);
  const open = (value: T) => { anchor.current = buttons.current.get(value) ?? null; setActive(value); };
  const navigate = (direction: -1 | 1) => {
    const enabled = items.filter(item => !item.disabled);
    if (!enabled.length) return;
    const index = enabled.findIndex(item => item.value === active);
    const next = enabled[(index + direction + enabled.length) % enabled.length]!;
    open(next.value);
  };
  return <>
    <div role="menubar" aria-label={label} className="ui-menu-bar" data-ui-component="menu-bar" data-suite-control="menu-bar"
      data-editor-native-tab-navigation={nativeKeys || undefined}>
      {items.map(item => <button type="button" role="menuitem" key={item.value} className="ui-menu-bar__item"
        ref={node => { if (node) buttons.current.set(item.value, node); else buttons.current.delete(item.value); }}
        disabled={item.disabled} tabIndex={-1} aria-haspopup="menu" aria-expanded={active === item.value}
        onClick={() => { if (active === item.value) setActive(null); else open(item.value); }}
        onPointerEnter={() => { if (active !== null && !item.disabled && active !== item.value) open(item.value); }}
        onKeyDown={event => {
          if (['ArrowDown', 'Enter', ' '].includes(event.key)) { event.preventDefault(); open(item.value); }
          else if (event.key === 'Escape') { event.preventDefault(); setActive(null); }
          else if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const enabled = items.filter(option => !option.disabled);
            const index = enabled.findIndex(option => option.value === item.value);
            const next = enabled[event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1
              : (index + (event.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length];
            if (next) { buttons.current.get(next.value)?.focus(); if (active !== null) open(next.value); }
          }
        }}>{item.label}</button>)}
    </div>
    {active !== null ? <Menu key={active} open anchor={anchor} placement="below" label={`${items.find(item => item.value === active)?.label} menu`}
      options={optionsFor(active)} onClose={() => setActive(null)} onNavigate={navigate}
      data-editor-native-tab-navigation={nativeKeys} /> : null}
  </>;
}
