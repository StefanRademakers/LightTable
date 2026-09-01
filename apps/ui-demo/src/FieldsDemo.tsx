import { useState } from 'react';
import { FileField, LinkedFields, NumberField, PathField, SearchField, Select, SelectField, Text, TextInput } from '@lighttable/ui';

export function FieldsDemo() {
  const [name, setName] = useState('Background copy');
  const [query, setQuery] = useState('Portrait');
  const [number, setNumber] = useState(50);
  const [preview, setPreview] = useState<number | null>(null);
  const [commits, setCommits] = useState(0);
  const [mode, setMode] = useState('normal');
  const [fileName, setFileName] = useState('No file selected');
  const [path, setPath] = useState('D:\\Pictures\\LightTableProject');
  const [width, setWidth] = useState(3000);
  const [height, setHeight] = useState(900);
  const [dimensionsLinked, setDimensionsLinked] = useState(true);
  const modes = [{ value: 'normal', label: 'Normal' }, { value: 'multiply', label: 'Multiply' },
    { value: 'screen', label: 'Screen' }, { value: 'unavailable', label: 'Unavailable', disabled: true }];
  return <>
    <header className="demo-intro">
      <Text as="h1" variant="large" weight="bold">Fields</Text>
      <Text as="p" tone="muted">Text, numbers, search and choices. Shared 28 px height and Regular typography; labels are composed separately.</Text>
    </header>
    <section className="demo-section">
      <Text as="h2" variant="large" weight="bold">Text input</Text>
      <div className="demo-colors">
        <label className="demo-color"><Text>Name</Text>
          <TextInput value={name} onChange={event => setName(event.currentTarget.value)} />
        </label>
        <label className="demo-color"><Text>Placeholder</Text>
          <TextInput placeholder="Enter a name" />
        </label>
        <label className="demo-color"><Text>Read-only</Text>
          <TextInput value="Original document" readOnly />
        </label>
        <label className="demo-color"><Text>Disabled</Text>
          <TextInput value="Unavailable" disabled />
        </label>
        <label className="demo-color"><Text>Invalid</Text>
          <TextInput aria-label="Invalid" defaultValue="Invalid value" aria-invalid="true" aria-describedby="invalid-field-help" />
          <Text id="invalid-field-help" variant="small" tone="muted">Validation and error messages belong to the app.</Text>
        </label>
        <label className="demo-color"><Text>Password</Text>
          <TextInput type="password" autoComplete="off" defaultValue="example" />
        </label>
      </div>
      <Text as="p" variant="small" tone="muted">One native input; refs, selection, autofill and native input events stay available. No extra wrapper.</Text>
      <pre className="demo-code"><Text as="code">{'<TextInput value={name} onChange={event => setName(event.currentTarget.value)} />'}</Text></pre>
    </section>
    <section className="demo-section">
      <Text as="h2" variant="large" weight="bold">Path field</Text>
      <div className="demo-colors">
        <label className="demo-color"><Text>Editable path</Text>
          <PathField value={path} onChange={event => setPath(event.currentTarget.value)}
            onBrowse={() => setPath('D:\\Pictures\\SelectedProject')} />
        </label>
        <label className="demo-color"><Text>Picker-owned path</Text>
          <PathField value="/Users/example/Pictures/LightTableProject" readOnly buttonLabel="Choose…"
            onBrowse={() => undefined} />
        </label>
        <label className="demo-color"><Text>Disabled</Text>
          <PathField value="Unavailable" disabled onBrowse={() => undefined} />
        </label>
      </div>
      <Text as="p" tone="muted">The package composes the 28 px field and button. The app supplies the native folder picker.</Text>
    </section>
    <section className="demo-section">
      <Text as="h2" variant="large" weight="bold">Linked fields</Text>
      <div className="demo-colors">
        <LinkedFields firstLabel="Width" secondLabel="Height" linked={dimensionsLinked}
          onLinkedChange={setDimensionsLinked}
          firstField={<NumberField value={width} min={1} kind="integer" onValueChange={(value) => {
            setWidth(value);
            if (dimensionsLinked) setHeight(Math.max(1, Math.round(value * 0.3)));
          }} />}
          secondField={<NumberField value={height} min={1} kind="integer" onValueChange={(value) => {
            setHeight(value);
            if (dimensionsLinked) setWidth(Math.max(1, Math.round(value / 0.3)));
          }} />} />
      </div>
      <Text as="p" tone="muted">The connector keeps its vertical proportions; field content remains standard package controls.</Text>
    </section>
    <section className="demo-section">
      <Text as="h2" variant="large" weight="bold">Search field</Text>
      <div className="demo-colors">
        <label className="demo-color"><Text>Search assets</Text>
          <SearchField aria-label="Search assets" value={query} placeholder="Search assets" onChange={event => setQuery(event.currentTarget.value)} onClear={() => setQuery('')} />
        </label>
        <label className="demo-color"><Text>Without clear action</Text>
          <SearchField placeholder="Search fonts" />
        </label>
        <label className="demo-color"><Text>Disabled search</Text>
          <SearchField aria-label="Disabled search" value="Unavailable" disabled onClear={() => {}} />
        </label>
      </div>
      <Text as="p" variant="small" tone="muted" role="status">{query ? `Search: ${query}` : 'Search is empty.'}</Text>
      <pre className="demo-code"><Text as="code">{'<SearchField value={query} onChange={event => setQuery(event.currentTarget.value)} onClear={() => setQuery(\'\')} />'}</Text></pre>
    </section>
    <section className="demo-section">
      <Text as="h2" variant="large" weight="bold">Numeric expression</Text>
      <div className="demo-colors">
        <label className="demo-color"><Text>Commit on Enter or blur</Text>
          <NumberField aria-label="Expression" value={number} min={0} max={2000} onValueChange={setNumber} />
        </label>
        <label className="demo-color"><Text>Immediate setting</Text>
          <NumberField aria-label="Immediate value" value={number} min={0} max={2000} updateMode="input" onValueChange={setNumber} />
        </label>
        <label className="demo-color"><Text>Mixed value / preview transaction</Text>
          <NumberField aria-label="Mixed value" value={preview} placeholder="Mixed" min={0} max={2000}
            onValueChange={setPreview} onPreview={setPreview} onCommit={() => setCommits(count => count + 1)}
            onCancel={() => setPreview(null)} bounds="reject" blurOnCommit />
        </label>
        <label className="demo-color"><Text>Disabled number</Text><NumberField value={number} onValueChange={setNumber} disabled /></label>
      </div>
      <Text as="p" role="status">Value: {number}. Preview: {preview ?? 'Mixed'}. Commits: {commits}.</Text>
      <Text as="p" tone="muted">Try 1920/2. Arrow keys step; Shift is coarse and Alt is fine. Escape cancels. Partial expressions never become zero.</Text>
    </section>
    <section className="demo-section">
      <Text as="h2" variant="large" weight="bold">Select / drop-up</Text>
      <div className="demo-colors">
        <label className="demo-color"><Text>Blend mode</Text><Select aria-label="Blend mode" value={mode} options={modes} onValueChange={setMode} /></label>
        <label className="demo-color"><Text>Open above</Text><Select aria-label="Open above" placement="above" value={mode} options={modes} onValueChange={setMode} /></label>
        <label className="demo-color"><Text>Searchable choice</Text><Select aria-label="Searchable choice" value={mode} options={modes} searchable onValueChange={setMode} /></label>
        <label className="demo-color"><Text>Disabled choice</Text><Select aria-label="Disabled choice" value={mode} options={modes} disabled /></label>
      </div>
      <Text as="p" tone="muted">One listbox with 28 px rows, keyboard navigation, disabled options, grouping and automatic viewport positioning.</Text>
    </section>
    <section className="demo-section">
      <Text as="h2" variant="large" weight="bold">Labeled panel fields</Text>
      <div className="demo-colors">
        <SelectField label="Blend mode" value={mode} options={modes} onChange={setMode} />
        <SelectField label="Channel" labelWidth="56px" value={mode} options={modes} onChange={setMode} />
        <FileField label="3D LUT" buttonLabel="Load .cube…" accept=".cube"
          onFile={file => setFileName(file.name)} />
      </div>
      <Text as="p" variant="small" tone="muted" role="status">{fileName}</Text>
      <Text as="p" tone="muted">The row owns label geometry; Select and Button retain their normal 28 px behavior.</Text>
    </section>
    <section className="demo-section">
      <Text as="h2" variant="large" weight="bold">Dialog keyboard access</Text>
      <label className="demo-color"><Text>Tab-enabled field</Text>
        <TextInput tabIndex={0} defaultValue="Tab reaches this field" />
      </label>
      <Text as="p" tone="muted">Controls stay out of the editor’s Tab sequence by default. Dialogs opt in with tabIndex=0.</Text>
    </section>
  </>;
}
