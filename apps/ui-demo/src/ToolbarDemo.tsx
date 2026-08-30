import { useState } from 'react';
import { Button, Toolbar, Text } from '@lighttable/ui';

const square = <svg viewBox="0 0 20 20" fill="none" stroke="currentColor"><path d="M3 3h14v14H3Z" /></svg>;
const circle = <svg viewBox="0 0 20 20" fill="none" stroke="currentColor"><circle cx="10" cy="10" r="7" /></svg>;
const pointer = <svg viewBox="0 0 20 20" fill="currentColor"><path d="m4 2 12 9-6 1-3 6Z" /></svg>;
export function ToolbarDemo() {
  const [tool, setTool] = useState('move');
  const [extensionCount, setExtensionCount] = useState(0);
  return <section className="demo-section">
    <Text as="h2" variant="large" weight="bold">Reusable toolbar with an app extension</Text>
    <div className="demo-button-row">
      <Toolbar label="Demo tools" value={tool} onChange={setTool} items={[
        { value: 'move', label: 'Move', shortcut: 'V', icon: pointer },
        { value: 'shapes', label: 'Shape tools', tools: [
          { value: 'rectangle', label: 'Rectangle', shortcut: 'U', icon: square },
          { value: 'ellipse', label: 'Ellipse', shortcut: 'U', icon: circle }
        ]}
      ]} extension={<Button title="Custom extension action" onClick={()=>setExtensionCount(count=>count+1)}>X</Button>} />
      <Text>Tool: {tool}. Custom extension clicks: {extensionCount}.</Text>
    </div>
    <Text as="p" tone="muted">One click activates the remembered tool and opens its group. The corner is part of the same button. The bottom slot belongs to the app; LightTable places its color picker there.</Text>
    <pre className="demo-code"><Text as="code">{'<Toolbar items={tools} value={activeTool} onChange={selectTool} extension={<AppColorPicker />} />'}</Text></pre>
  </section>;
}
