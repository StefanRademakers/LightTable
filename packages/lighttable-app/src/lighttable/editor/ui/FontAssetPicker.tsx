import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DocumentFontAsset } from '../document/documentTypes';
import { navigateFontPicker } from './fontPickerKeyboard';

const label = (font: DocumentFontAsset) => {
  const family = font.familyNames[0] ?? font.postScriptName ?? 'Unknown';
  return `${family} — ${font.styleName}`;
};

export const FontAssetPicker: React.FC<{
  readonly value: string;
  readonly fonts: readonly DocumentFontAsset[];
  readonly ariaLabel: string;
  readonly onChange: (assetId: string) => void;
}> = ({ value, fonts, ariaLabel, onChange }) => {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const selected = fonts.find((font) => font.assetId === value);
  const groups = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return ([
      ['Bundled', (font: DocumentFontAsset) => font.source === 'bundled'],
      ['Document', (font: DocumentFontAsset) => font.source !== 'bundled' && font.source !== 'system'],
      ['System', (font: DocumentFontAsset) => font.source === 'system']
    ] as const).map(([groupLabel, accepts]) => ({
      label: groupLabel,
      fonts: fonts.filter(accepts).filter((font) => !needle || [
        ...font.familyNames, font.styleName, font.postScriptName ?? ''
      ].some((part) => part.toLocaleLowerCase().includes(needle)))
        .sort((left, right) => label(left).localeCompare(label(right)))
    })).filter((group) => group.fonts.length > 0);
  }, [fonts, query]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const update = () => {
      const bounds = anchorRef.current?.getBoundingClientRect();
      if (!bounds) return;
      setPosition({
        left: Math.max(8, Math.min(bounds.left, window.innerWidth - 252)),
        top: Math.min(bounds.bottom + 3, window.innerHeight - 220)
      });
    };
    update();
    searchRef.current?.focus({ preventScroll: true });
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [open]);

  React.useEffect(() => {
    if (!open) return undefined;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (anchorRef.current?.contains(target)
        || document.querySelector('.lighttable-font-picker__menu')?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  return <>
    <button ref={anchorRef} type="button" className="lighttable-font-picker__trigger"
      aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open}
      title={selected ? label(selected) : 'Choose font'}
      onClick={() => { setQuery(''); setOpen((current) => !current); }}>
      <span>{selected ? label(selected) : 'Choose font'}</span><span aria-hidden="true">▾</span>
    </button>
    {open ? createPortal(<div className="lighttable-font-picker__menu" style={position}
      data-editor-native-tab-navigation onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault(); setOpen(false); anchorRef.current?.focus(); return;
        }
        navigateFontPicker(event);
      }}>
      <input ref={searchRef} type="search" value={query} placeholder="Search fonts"
        aria-label="Search fonts" onChange={(event) => setQuery(event.currentTarget.value)} />
      <div className="lighttable-font-picker__options" role="listbox" aria-label="Fonts">
        {groups.map((group) => <React.Fragment key={group.label}>
          <div className="lighttable-font-picker__group">{group.label}</div>
          {group.fonts.map((font) => <button key={font.assetId} type="button" role="option"
            aria-selected={font.assetId === value}
            className={font.assetId === value
              ? 'lighttable-font-picker__option lighttable-font-picker__option--selected'
              : 'lighttable-font-picker__option'}
            onClick={() => { onChange(font.assetId); setOpen(false); anchorRef.current?.focus(); }}>
            {label(font)}
          </button>)}
        </React.Fragment>)}
        {groups.length === 0
          ? <div className="lighttable-font-picker__empty">No matching fonts</div> : null}
      </div>
    </div>, document.body) : null}
  </>;
};
