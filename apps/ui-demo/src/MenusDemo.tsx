import { useRef, useState } from 'react';
import { Button, Menu, MenuBar, Text, type MenuOption } from '@lighttable/ui';
import { ToolbarDemo } from './ToolbarDemo';

const disc = <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" /><path d="M8 2a6 6 0 0 1 0 12Z" fill="currentColor" /></svg>;
const link = <svg viewBox="0 0 16 16" fill="none" stroke="currentColor"><rect x="5" y="1" width="6" height="9" rx="3" /><rect x="5" y="6" width="6" height="9" rx="3" /></svg>;

export function MenusDemo() {
  const [feedback, setFeedback] = useState('Choose a command. This demo does not change documents.');
  const [open, setOpen] = useState<'adjustments' | 'effects' | null>(null);
  const [themeChoice, setThemeChoice] = useState('dark');
  const adjustmentAnchor = useRef<HTMLButtonElement>(null);
  const effectAnchor = useRef<HTMLButtonElement>(null);
  const command = (value: string, label: string, extra: Partial<MenuOption> = {}): MenuOption => ({
    value, label, onClick: () => setFeedback(label), ...extra
  });
  const adjustments = ['Grade', 'Lens Fx', 'Brightness / Contrast', 'Levels', 'Curves', 'Exposure',
    'Color and Vibrance', 'Hue / Saturation', 'Color Balance', 'Black & White', 'Photo Filter', 'Channel Mixer',
    'Color Lookup', 'Invert', 'Posterize', 'Threshold', 'Gradient Map', 'Selective Color', 'Clarity and Dehaze', 'Gaussian Blur']
    .map((name, index) => command(name, name, { icon: disc, separatorBefore: [2, 6, 13, 18, 19].includes(index),
      trailingAction: { value: `attach-${name}`, label: `Attach ${name}`, icon: link,
        disabled: name === 'Lens Fx', disabledReason: 'Choose a raster layer first.',
        onClick: () => setFeedback(`Attached ${name}`) }
    }));
  const effects = ['Drop Shadow', 'Inner Shadow', 'Outer Glow', 'Inner Glow', 'Bevel & Emboss', 'Color Overlay',
    'Gradient Overlay', 'Pattern Overlay', 'Satin', 'Stroke'].map(name => command(name, name));
  const menus: Record<string, MenuOption[]> = {
    file: [command('new', 'New…', {shortcut:'Ctrl+N'}), command('open', 'Open…', {shortcut:'Ctrl+O'}),
      {value:'recent',label:'Open Recent',children:[command('recent-a','Portrait.webp'), command('recent-b','Landscape.png')]},
      command('save', 'Save', {shortcut:'Ctrl+S',separatorBefore:true,disabled:true,disabledReason:'No unsaved changes.'}),
      {value:'export',label:'Export',children:[command('png','Quick Export as PNG'), {value:'formats',label:'Other Formats',children:[command('jpg','JPEG'),command('webp','WebP')]}]},
      command('close','Close', {separatorBefore:true})],
    select: [command('all','All',{shortcut:'Ctrl+A'}), command('deselect','Deselect',{shortcut:'Ctrl+D',disabled:true}),
      command('inverse','Inverse',{shortcut:'Ctrl+Shift+I'}),
      {value:'modify',label:'Modify',separatorBefore:true,children:['Expand…','Contract…','Feather…'].map(name=>command(name,name))}],
    layer: [{value:'adjustment',label:'Add Adjustment',children:adjustments}, {value:'effect',label:'Add Effect',children:effects}],
    view: [{value:'theme',label:'Theme',children:['light','dark'].map(value=>({value,label:value==='light'?'Light':'Dark',selected:themeChoice===value,onClick:()=>setThemeChoice(value)}))}]
  };
  return <>
    <header className="demo-intro"><Text as="h1" variant="large" weight="bold">Menus &amp; navigation</Text>
      <Text as="p" tone="muted">One menu: 28 px rows, 2 px spacing. Icons, shortcuts, submenus and independent trailing actions.</Text></header>
    <section className="demo-section">
      <Text as="h2" variant="large" weight="bold">Application menu bar</Text>
      <MenuBar label="Demo application menu" items={['File','Select','Layer','View'].map(label=>({value:label.toLowerCase(),label}))} optionsFor={value=>menus[value]??[]} />
      <Text as="p" variant="small" tone="muted">Arrows / Home / End navigate. Right opens a submenu; Left returns. Escape closes and restores focus. Disabled commands explain why.</Text>
    </section>
    <section className="demo-section">
      <Text as="h2" variant="large" weight="bold">The same menu from a panel</Text>
      <div className="demo-button-row">
        <Button ref={adjustmentAnchor} onClick={()=>setOpen(open==='adjustments'?null:'adjustments')}>Adjustment layers</Button>
        <Button ref={effectAnchor} onClick={()=>setOpen(open==='effects'?null:'effects')}>Layer FX</Button>
      </div>
      <Text as="p" role="status">{feedback}</Text>
      <Menu open={open==='adjustments'} anchor={adjustmentAnchor} label="Adjustment layers" width={220} align="end" gap={6}
        options={adjustments} onClose={()=>setOpen(null)} />
      <Menu open={open==='effects'} anchor={effectAnchor} label="Layer FX" width={220} align="end" gap={6}
        options={effects} onClose={()=>setOpen(null)} />
    </section>
    <ToolbarDemo />
    <section className="demo-section">
      <Text as="h2" variant="large" weight="bold">Usage</Text>
      <pre className="demo-code"><Text as="code">{'<MenuBar items={menus} optionsFor={getCommands} />\n<Menu open={open} anchor={triggerRef} options={commands} onClose={close} />'}</Text></pre>
      <Text as="p" tone="muted">The host owns commands and availability. The library owns rows, theme, focus, viewport placement and scrolling. No app CSS.</Text>
    </section>
  </>;
}
