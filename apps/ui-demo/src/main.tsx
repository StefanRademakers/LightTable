import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@lighttable/ui/fonts.css';
import '@lighttable/ui/styles.css';
import { Text, type TextVariant } from '@lighttable/ui';
import './demo.css';

const variants: { variant: TextVariant; label: string; usage: string }[] = [
  { variant: 'large', label: 'Large', usage: 'Titles and headings' },
  { variant: 'regular', label: 'Regular', usage: 'Controls and body text' },
  { variant: 'small', label: 'Small', usage: 'Metadata and compact notes' }
];

function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  return <div className="demo" data-ui-theme={theme}>
    <header className="demo-header">
      <Text variant="large" weight="bold">LightTable UI</Text>
      <div className="demo-themes" role="group" aria-label="Theme">
        {(['dark', 'light'] as const).map(mode => <button key={mode} type="button"
          aria-pressed={theme === mode} onClick={() => setTheme(mode)}>
          <Text weight={theme === mode ? 'bold' : 'normal'}>{mode === 'dark' ? 'Dark' : 'Light'}</Text>
        </button>)}
      </div>
    </header>
    <nav className="demo-nav" aria-label="Component categories">
      <Text as="p" weight="bold">Foundations</Text>
      <a href="#typography" aria-current="page"><Text>Typography</Text></a>
      <Text as="p" variant="small" tone="muted">Built one component at a time.</Text>
    </nav>
    <main id="typography" className="demo-content">
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
    </main>
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
