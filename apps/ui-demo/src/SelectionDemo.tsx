import { useState } from 'react';
import { Checkbox, SegmentedControl, SwitchControl, Text } from '@lighttable/ui';

export function SelectionDemo() {
  const [enabled, setEnabled] = useState(true);
  const [checked, setChecked] = useState(true);
  const [alignment, setAlignment] = useState('left');
  const options = [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }];
  return <>
    <header className="demo-intro">
      <Text as="h1" variant="large" weight="bold">Selection</Text>
      <Text as="p" tone="muted">Persistent choices: switches, checkboxes and segmented controls. Actions belong under Buttons.</Text>
    </header>
    <section className="demo-section">
      <Text as="h2" variant="large" weight="bold">Switch</Text>
      <Text as="p" tone="muted">Enable or disable a section or feature. One 36 × 20 px size.</Text>
      <div className="demo-button-row">
        <SwitchControl label="Example switch" checked={enabled} onCheckedChange={setEnabled} />
        <SwitchControl label="Disabled off switch" checked={false} onCheckedChange={() => {}} disabled />
        <SwitchControl label="Disabled on switch" checked onCheckedChange={() => {}} disabled />
      </div>
      <Text as="p" variant="small" tone="muted" role="status">{enabled ? 'On' : 'Off'} · disabled off · disabled on</Text>
      <pre className="demo-code"><Text as="code">{'<SwitchControl label="Enable effect" checked={enabled} onCheckedChange={setEnabled} />'}</Text></pre>
    </section>
    <section className="demo-section">
      <Text as="h2" variant="large" weight="bold">Checkbox</Text>
      <Text as="p" tone="muted">An independent boolean option. Native 13 px input; compact hides only the visible label.</Text>
      <div className="demo-button-row">
        <Checkbox label="Example checkbox" checked={checked} onCheckedChange={setChecked} />
        <Checkbox label="Disabled checkbox" checked={false} disabled />
        <Checkbox label="Disabled checked checkbox" checked disabled />
        <Checkbox label="Compact checkbox" compact checked={checked} onCheckedChange={setChecked} />
      </div>
      <Text as="p" variant="small" tone="muted" role="status">{checked ? 'Checked' : 'Unchecked'} — labelled and compact examples share the same value.</Text>
      <pre className="demo-code"><Text as="code">{'<Checkbox label="Preserve color" checked={checked} onCheckedChange={setChecked} />'}</Text></pre>
    </section>
    <section className="demo-section">
      <Text as="h2" variant="large" weight="bold">Segmented control</Text>
      <Text as="p" tone="muted">Choose one of several options. Three items, 28 px high; width fits content.</Text>
      <SegmentedControl label="Alignment" value={alignment} onChange={setAlignment} options={options} />
      <Text as="p" variant="small" tone="muted" role="status">Selected: {alignment}</Text>
      <Text as="h3" weight="bold">Quiet variant</Text>
      <SegmentedControl label="Quiet alignment" variant="quiet" value={alignment} onChange={setAlignment} options={options} />
      <Text as="p" variant="small" tone="muted">For unobtrusive navigation. Same sizing and behavior, without an outer border or blue fill.</Text>
      <pre className="demo-code"><Text as="code">{'<SegmentedControl label="Alignment" options={options} value={alignment} onChange={setAlignment} />'}</Text></pre>
    </section>
  </>;
}
