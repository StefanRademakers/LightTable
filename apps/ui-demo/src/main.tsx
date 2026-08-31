import { Button, Text, type TextVariant } from '@lighttable/ui';
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@lighttable/ui/fonts.css';
import '@lighttable/ui/styles.css';

import './demo.css';
import { MenusDemo } from './MenusDemo';
import { SlidersDemo } from './SlidersDemo';
import { ColorPickerDemo } from './ColorPickerDemo';
import { PanelsDemo } from './PanelsDemo';
import { SelectionDemo } from './SelectionDemo';
import { FieldsDemo } from './FieldsDemo';
import { ScopesDemo } from './ScopesDemo';

const variants: { variant: TextVariant; label: string; usage: string }[] = [
  { variant: 'large', label: 'Large', usage: 'Titles and headings' },
  { variant: 'regular', label: 'Regular', usage: 'Controls and body text' },
  { variant: 'small', label: 'Small', usage: 'Metadata and compact notes' }
];

const catalog = [
  { label: 'Foundations', pages: [{ id: 'typography', label: 'Typography' }, { id: 'colors', label: 'Colors' }] },
  { label: 'Controls', pages: [
    { id: 'buttons', label: 'Buttons & actions' }, { id: 'fields', label: 'Fields' }, { id: 'selection', label: 'Selection' },
    { id: 'sliders', label: 'Sliders & gradients' }, { id: 'color-picker', label: 'Paint & color' },
    { id: 'menus', label: 'Menus & navigation' },
    { id: 'document-tabs', label: 'Document tabs' }
  ] },
  { label: 'Containers', pages: [{ id: 'panels', label: 'Panel sections' }] },
  { label: 'Visualization', pages: [{ id: 'scopes', label: 'Scopes' }] }
] as const;
const catalogPages = catalog.flatMap(group => [...group.pages]);
const currentPage = () => catalogPages.find(page => `#${page.id}` === location.hash)?.id ?? 'typography';

const controlColors = [
  ['button-surface', 'Control background'], ['button-text', 'Control text'],
  ['button-border', 'Control border'], ['button-hover', 'Hover'],
  ['button-active', 'Pressed'], ['button-disabled-text', 'Disabled text'],
  ['button-disabled-border', 'Disabled border'], ['danger-text', 'Destructive text'],
  ['danger-border', 'Destructive border'], ['selection-surface', 'Selected segment'],
  ['selection-text', 'Selected text'], ['accent', 'Focus / toggle border'], ['success', 'Connected status'],
  ['slider-track', 'Slider track'], ['slider-fill', 'Slider fill'], ['slider-thumb', 'Slider handle'],
  ['checker-dark', 'Transparency dark'], ['checker-light', 'Transparency light'],
  ['surface-inset', 'Panel content'],
  ['scope-red', 'Red channel'], ['scope-green', 'Green channel'], ['scope-blue', 'Blue channel']
] as const;

function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  useEffect(() => { document.documentElement.dataset.uiTheme = theme; }, [theme]);
  const [page, setPage] = useState(currentPage);
  useEffect(() => {
    const updatePage = () => setPage(currentPage());
    window.addEventListener('hashchange', updatePage);
    return () => window.removeEventListener('hashchange', updatePage);
  }, []);
  const [buttonFeedback, setButtonFeedback] = useState('Click a button to try it.');
  useEffect(() => {
    document.title = `LightTable UI · ${catalogPages.find(entry => entry.id === page)?.label}`;
  }, [page]);
  return <div className="demo" data-ui-theme={theme}>
    <header className="demo-header">
      <Text variant="large" weight="bold">LightTable UI</Text>
      <div className="demo-themes" role="group" aria-label="Theme">
        {(['dark', 'light'] as const).map(mode => <Button key={mode}
          aria-pressed={theme === mode} onClick={() => setTheme(mode)}>
          {mode === 'dark' ? 'Dark' : 'Light'}
        </Button>)}
      </div>
    </header>
    <nav className="demo-nav" aria-label="Component categories">
      {catalog.map(group => <React.Fragment key={group.label}>
        <Text as="p" weight="bold">{group.label}</Text>
        {group.pages.map(entry => <a key={entry.id} href={`#${entry.id}`} aria-current={page === entry.id ? 'page' : undefined}>
          <Text>{entry.label}</Text>
        </a>)}
      </React.Fragment>)}
    </nav>
    <main className="demo-content">
      {page === 'document-tabs' ? <DocumentTabsDemo /> : page === 'scopes' ? <ScopesDemo /> : page === 'fields' ? <FieldsDemo /> : page === 'selection' ? <SelectionDemo /> : page === 'panels' ? <PanelsDemo /> : page === 'color-picker' ? <ColorPickerDemo /> : page === 'sliders' ? <SlidersDemo /> : page === 'menus' ? <MenusDemo /> : page === 'typography' ? <>
      <header className="demo-intro">
        <Text as="h1" variant="large" weight="bold">Typography</Text>
        <Text as="p" tone="muted">Inter. Three sizes, two weights. One shared type system for every app.</Text>
      </header>

      <section className="demo-section" aria-labelledby="scale-title">
        <Text as="h2" variant="large" weight="bold" id="scale-title">Type scale</Text>
        <div className="demo-table-scroll">
          <table className="demo-scale">
            <thead><tr>
              <th scope="col"><Text weight="bold">Type</Text></th>
              <th scope="col"><Text weight="bold">Normal · 400</Text></th>
              <th scope="col"><Text weight="bold">Bold · 700</Text></th>
            </tr></thead>
            <tbody>{variants.map(({ variant, label, usage }) => <tr key={variant}>
              <th scope="row"><Text>{label}</Text><Text as="p" variant="small" tone="muted">{usage}</Text></th>
              <td><Text variant={variant}>The quick brown fox · 0123456789</Text></td>
              <td><Text variant={variant} weight="bold">The quick brown fox · 0123456789</Text></td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>

      <section className="demo-section" aria-labelledby="context-title">
        <Text as="h2" variant="large" weight="bold" id="context-title">In context</Text>
        <article className="demo-specimen">
          <Text as="h3" variant="large" weight="bold">Document properties</Text>
          <Text as="p">Keep your original image and its editable layers together.</Text>
          <Text as="p" variant="small" tone="muted">Changes are saved to the current document.</Text>
        </article>
      </section>

      <section className="demo-section" aria-labelledby="usage-title">
        <Text as="h2" variant="large" weight="bold" id="usage-title">Usage</Text>
        <Text as="p" tone="muted">Choose a type, not a pixel size. Semantic HTML stays independent of appearance.</Text>
        <pre className="demo-code"><Text as="code">{`<Text as="h2" variant="large" weight="bold">Title</Text>\n<Text as="p">Normal body text</Text>\n<Text variant="small" tone="muted">Supporting information</Text>`}</Text></pre>
        <Text as="p" variant="small" tone="muted">One HTML element per Text. No wrappers. No editor dependencies. Fonts are bundled locally.</Text>
      </section>

      </> : page === 'colors' ? <>
        <header className="demo-intro">
          <Text as="h1" variant="large" weight="bold">Colors</Text>
          <Text as="p" tone="muted">Shared color roles. We will build this palette one color at a time.</Text>
        </header>
        <section className="demo-section" aria-labelledby="surfaces-title">
          <Text as="h2" variant="large" weight="bold" id="surfaces-title">Surfaces</Text>
          <div className="demo-colors">
            <article className="demo-color">
              <div className="demo-color-swatch" style={{ background: 'var(--ui-surface)' }} aria-hidden="true" />
              <Text weight="bold">Navigation &amp; specimen surface</Text>
              <Text as="code" variant="small" tone="muted">--ui-surface</Text>
            </article>
            <article className="demo-color">
              <div className="demo-color-swatch" style={{ background: 'var(--ui-surface-panel)' }} aria-hidden="true" />
              <Text weight="bold">Panel surface</Text>
              <Text as="code" variant="small" tone="muted">--ui-surface-panel</Text>
            </article>
          </div>
        </section>
        <section className="demo-section" aria-labelledby="control-colors-title">
          <Text as="h2" variant="large" weight="bold" id="control-colors-title">Controls</Text>
          <div className="demo-colors">{controlColors.map(([token, label]) => <article className="demo-color" key={token}>
            <div className="demo-color-swatch" style={{ background: `var(--ui-${token})` }} aria-hidden="true" />
            <Text weight="bold">{label}</Text>
            <Text as="code" variant="small" tone="muted">{`--ui-${token}`}</Text>
          </article>)}</div>
        </section>
      </> : <>
      <header className="demo-intro"><Text as="h1" variant="large" weight="bold">Buttons &amp; Actions</Text></header>
      <section className="demo-section" aria-labelledby="buttons-title">
        <Text as="h2" variant="large" weight="bold" id="buttons-title">Button</Text>
        <Text as="p" tone="muted">One height: 28 px. Regular typography. Content determines the width.</Text>
        <div className="demo-button-row">
          <Button onClick={() => setButtonFeedback('Enabled button activated.')}>Enabled</Button>
          <Button disabled onClick={() => setButtonFeedback('Disabled button must never activate.')}>Disabled</Button>
          <Button intent="destructive" onClick={() => setButtonFeedback('Destructive button activated — demo only, nothing deleted.')}>Destructive</Button>
        </div>
        <Text as="p" variant="small" tone="muted" role="status">{buttonFeedback}</Text>
        <pre className="demo-code"><Text as="code">{`<Button onClick={save}>Save</Button>\n<Button disabled>Disabled</Button>\n<Button intent="destructive" onClick={remove}>Delete</Button>`}</Text></pre>
        <Text as="p" variant="small" tone="muted">No tab stop in app chrome. Dialogs opt into tab navigation. No inner spans or wrapper divs.</Text>
      </section>
      </>}
    </main>
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
import { DocumentTabsDemo } from './DocumentTabsDemo';
