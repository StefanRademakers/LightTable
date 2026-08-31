import { useState } from 'react';
import { Checkbox, SwitchControl, IconButton, MaskIcon, resetIconUrl, PanelFooter, PanelSection, PanelSectionHeader, PanelTab, SliderField, Text, TextInput } from '@lighttable/ui';

const resetIcon = <MaskIcon src={resetIconUrl} />;

export function PanelsDemo() {
  const [expanded, setExpanded] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [value, setValue] = useState(35);
  const [preserveColor, setPreserveColor] = useState(true);
  const [feedback, setFeedback] = useState('Header actions do not collapse the section.');
  const reset = () => { setValue(35); setFeedback('Reset once; expansion unchanged.'); };
  return <>
    <header className="demo-intro">
      <Text as="h1" variant="large" weight="bold">Containers · Panel sections</Text>
      <Text as="p" tone="muted">One 34 px header, matching toolbar flyout rows. Static, nested and collapsible sections share the same geometry.</Text>
    </header>
    <section className="demo-section">
      <div className="demo-button-row" style={{ alignItems: 'start', flexWrap: 'wrap' }}>
        <div style={{ width: 260, maxWidth: '100%' }}>
          <PanelSection label="Light" expanded={expanded} onExpandedChange={setExpanded}
            onToggleClick={event => { if (event.shiftKey) { event.preventDefault(); reset(); } }}
            actions={<><IconButton variant="quiet" aria-label="Reset Light" icon={resetIcon} onClick={reset} />
              <SwitchControl label="Enable Light" checked={enabled} onCheckedChange={setEnabled} /></>}>
            <SliderField label="Exposure" value={value} min={0} max={100} onChange={setValue} disabled={!enabled} />
            <PanelSection label="Advanced" variant="disclosure" keepMounted>
              <Checkbox label="Preserve color" checked={preserveColor} onCheckedChange={setPreserveColor} />
            </PanelSection>
          </PanelSection>
          <PanelSection label="A long asset folder name that should truncate without moving the header actions"
            actions={<IconButton variant="quiet" aria-label="Refresh folder" icon={resetIcon} onClick={() => setFeedback('Folder refreshed; expansion unchanged.')} />}>
            <Text>No images in this folder.</Text>
          </PanelSection>
          <PanelSection label="Scope (keep mounted)" defaultExpanded keepMounted>
            <TextInput aria-label="Scope binding example" defaultValue="Keep this DOM node" />
          </PanelSection>
        </div>
        <div style={{ width: 420, maxWidth: '100%' }}>
          <PanelSectionHeader label="Levels — static header" actions={<IconButton variant="quiet" aria-label="Reset Levels" icon={resetIcon} onClick={() => setFeedback('Levels reset.')} />} />
          <PanelSection label="Detail" defaultExpanded>
            <PanelSection label="Sharpening" alwaysVisible={<SliderField label="Amount" value={value} min={0} max={100} onChange={setValue} />}>
              <Text>Advanced settings collapse; Amount stays visible.</Text>
            </PanelSection>
          </PanelSection>
          <PanelSection label="Unmounted content" defaultExpanded>
            <TextInput aria-label="Unmount example" defaultValue="Resets after collapse" />
          </PanelSection>
        </div>
      </div>
      <Text as="p" role="status" tone="muted">{feedback}</Text>
    </section>
    <section className="demo-section">
      <Text as="h2" variant="large" weight="bold">Panel chrome</Text>
      <div style={{ width: 320, maxWidth: '100%', background: 'var(--ui-surface-panel)', border: '1px solid var(--ui-border)' }}>
        <div style={{ display: 'flex', height: 30, background: 'var(--ui-button-surface)' }}>
          <PanelTab selected>Layers</PanelTab><PanelTab>Channels</PanelTab><PanelTab>Scopes</PanelTab>
        </div>
        <div style={{ minHeight: 120, padding: 8 }}><Text tone="muted">Feature-owned panel content</Text></div>
        <PanelFooter style={{ margin: 0 }}>
          <IconButton variant="quiet" aria-label="Example panel action" icon={resetIcon} />
        </PanelFooter>
      </div>
      <Text as="p" tone="muted">PanelTab owns the shared 30 px tab surface. PanelFooter owns footer geometry; each feature supplies its own actions and behavior.</Text>
    </section>
    <section className="demo-section">
      <Text as="h2" variant="large" weight="bold">Usage</Text>
      <pre className="demo-code"><Text as="code">{'<PanelSection label="Light" expanded={open} onExpandedChange={setOpen} actions={actions}>\n  {content}\n</PanelSection>'}</Text></pre>
      <Text as="p" tone="muted">Use keepMounted for live canvas bindings, alwaysVisible for primary controls, and PanelSectionHeader for standalone titles. Expansion state, enabled state, commands and persistence belong to the app.</Text>
    </section>
  </>;
}
