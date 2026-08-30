import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';

export interface ToolbarTool<T extends string = string> {
  value: T;
  label: string;
  icon: ReactNode;
  shortcut?: string;
  disabled?: boolean;
  onDoubleClick?: () => void;
}
export interface ToolbarGroup<T extends string = string> { value: string; label: string; tools: readonly ToolbarTool<T>[] }
export interface ToolbarProps<T extends string = string> {
  items: readonly (ToolbarTool<T> | ToolbarGroup<T>)[];
  value: T;
  onChange: (value: T) => void;
  label?: string;
  /** App-specific content, such as foreground/background color controls. */
  extension?: ReactNode;
  'data-document-kind'?: string;
  'data-editor-floating-surface'?: boolean;
  'data-editor-native-tab-navigation'?: boolean;
}

export interface ToolButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: ReactNode;
  label: string;
  shortcut?: string;
  active?: boolean;
  detailed?: boolean;
}

export function ToolButton({ icon, label, shortcut, active = false, detailed = false, ...props }: ToolButtonProps) {
  const accessibleLabel = shortcut ? `${label} (${shortcut})` : label;
  return <button type="button" tabIndex={-1} {...props} className="ui-toolbar__button" data-detailed={detailed || undefined}
    aria-label={accessibleLabel} title={accessibleLabel} aria-pressed={active}>
    <span className="ui-toolbar__icon" aria-hidden="true">{icon}</span>
    {detailed ? <><span className="ui-toolbar__label">{label}</span><span className="ui-toolbar__shortcut" aria-hidden="true">{shortcut}</span></> : null}
  </button>;
}

/** A compact tool strip, for example beside a contextual tool-options popup. */
export function ToolStrip({ label, children }: { label: string; children: ReactNode }) {
  return <div className="ui-toolbar__strip" role="toolbar" aria-label={label}>{children}</div>;
}

function ToolGroup<T extends string>({ group, value, onChange, expanded, collapse, nativeKeys }: {
  group: ToolbarGroup<T>; value: T; onChange: (value:T)=>void; expanded: boolean; collapse:()=>void; nativeKeys?: boolean;
}) {
  const active = group.tools.find(tool => tool.value === value);
  const [remembered, setRemembered] = useState(group.tools[0]?.value);
  const [open, setOpen] = useState(false);
  const [generation, setGeneration] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const flyout = useRef<HTMLDivElement>(null);
  const focusOnOpen = useRef(false);
  const master = active ?? group.tools.find(tool => tool.value === remembered) ?? group.tools[0];
  useEffect(() => { if (active) setRemembered(active.value); }, [active?.value]);
  useEffect(() => {
    if (!open || expanded) return;
    const timeout = setTimeout(() => setOpen(false), 3_000);
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside, true);
    return () => { clearTimeout(timeout); document.removeEventListener('pointerdown', outside, true); };
  }, [open, expanded, generation]);
  useEffect(() => { if (!expanded) setOpen(false); }, [expanded]);
  useEffect(() => {
    if (!open || !focusOnOpen.current) return;
    focusOnOpen.current = false;
    flyout.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [open, generation]);
  if (!master) return null;
  const show = () => { setOpen(true); setGeneration(current=>current+1); };
  return <div ref={root} className="ui-toolbar__group" data-tool-group={group.label}
    onBlur={event=>{ if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <ToolButton icon={master.icon} label={master.label} shortcut={master.shortcut} active={Boolean(active)} disabled={master.disabled}
      aria-haspopup="true" aria-expanded={open || expanded}
      onClick={()=>{onChange(master.value);show();}}
      onDoubleClick={master.onDoubleClick}
      onKeyDown={event=>{if(event.key==='ArrowDown'){event.preventDefault();focusOnOpen.current=true;show();}}} />
    {open || expanded ? <div ref={flyout} className="ui-toolbar__flyout" data-expanded={expanded || undefined}
      role="toolbar" aria-label={group.label} aria-orientation={expanded?'horizontal':'vertical'}
      data-editor-native-tab-navigation={nativeKeys || undefined}
      onKeyDown={event=>{
        const buttons=[...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        const current=buttons.indexOf(document.activeElement as HTMLButtonElement);
        if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setOpen(false);collapse();root.current?.querySelector('button')?.focus();return;}
        const previous=expanded?'ArrowLeft':'ArrowUp',next=expanded?'ArrowRight':'ArrowDown';
        if(![previous,next,'Home','End'].includes(event.key))return;
        event.preventDefault();event.stopPropagation();
        buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(Math.max(0,current)+(event.key===next?1:-1)+buttons.length)%buttons.length]?.focus();
      }}>
      {group.tools.map(tool=><ToolButton key={tool.value} icon={tool.icon} label={tool.label} shortcut={tool.shortcut}
        active={value===tool.value} detailed={!expanded} disabled={tool.disabled}
        onClick={()=>{setRemembered(tool.value);setOpen(false);if(expanded)collapse();onChange(tool.value);}} />)}
    </div>:null}
  </div>;
}

export function Toolbar<T extends string>({items,value,onChange,label='Tools',extension,
  'data-document-kind':kind,'data-editor-floating-surface':floating,'data-editor-native-tab-navigation':nativeKeys}:ToolbarProps<T>) {
  const [expanded,setExpanded]=useState(false);
  const root=useRef<HTMLElement>(null);
  useEffect(()=>{
    if(!expanded)return;
    const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setExpanded(false);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();setExpanded(false);}};
    document.addEventListener('pointerdown',outside,true);
    window.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',outside,true);window.removeEventListener('keydown',escape);};
  },[expanded]);
  return <nav ref={root} className="ui-toolbar" aria-label={label} data-ui-component="toolbar" data-suite-control="toolbar"
    data-document-kind={kind} data-editor-floating-surface={floating || undefined}>
    {items.map(item=>'tools' in item?<ToolGroup key={item.value} group={item} value={value} onChange={onChange}
      expanded={expanded} collapse={()=>setExpanded(false)} nativeKeys={nativeKeys} />
      :<ToolButton key={item.value} label={item.label} icon={item.icon} shortcut={item.shortcut} active={value===item.value}
        disabled={item.disabled} onClick={()=>onChange(item.value)} onDoubleClick={item.onDoubleClick} />)}
    {items.some(item=>'tools' in item)?<ToolButton label={expanded?'Collapse all tool submenus':'Expand all tool submenus'}
      active={expanded} aria-expanded={expanded} onClick={()=>setExpanded(current=>!current)}
      icon={<svg viewBox="0 0 20 20" fill="currentColor"><circle cx="4" cy="10" r="1"/><circle cx="10" cy="10" r="1"/><circle cx="16" cy="10" r="1"/></svg>} />:null}
    {extension}
  </nav>;
}
