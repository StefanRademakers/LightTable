import React, { useState } from 'react';
import { ColorWheel, Select, SliderField, Text } from '@lighttable/ui';

export function ColorWheelDemo() {
  const [mode, setMode] = useState('midtones');
  const [value, setValue] = useState({ hue: 323, saturation: 25 });
  const [luminance, setLuminance] = useState(0);
  const [commits, setCommits] = useState(0);
  const change = (hue: number, saturation: number) => setValue({ hue, saturation });
  const reset = () => { setValue({ hue: 0, saturation: 0 }); setLuminance(0); };
  return <section className="demo-section">
    <Text as="h2" variant="large" weight="bold">Color wheel</Text>
    <Text as="p" tone="muted">Direct hue/saturation feedback, one commit per gesture. Shift-click or double-click resets. Arrow keys adjust hue/saturation when focused.</Text>
    <div className="demo-wheel-examples">
      <div className="demo-section">
        <Select aria-label="Color wheel tonal range" value={mode} onValueChange={setMode} options={[
          { value: 'global', label: 'Global' }, { value: 'shadows', label: 'Shadows' },
          { value: 'midtones', label: 'Midtones' }, { value: 'highlights', label: 'Highlights' }
        ]} />
        <ColorWheel label={mode[0].toUpperCase() + mode.slice(1)} {...value} luminance={luminance}
          onChange={change} onReset={reset} onInteractionEnd={() => setCommits(count => count + 1)} />
        <SliderField label="Luminance" value={luminance} min={-100} max={100} onChange={setLuminance} />
      </div>
      <div className="demo-section">
        <Text weight="bold">Compact</Text>
        <ColorWheel label="Shadows" compact {...value} luminance={luminance}
          onChange={change} onReset={reset} onInteractionEnd={() => setCommits(count => count + 1)} />
        <ColorWheel label="Disabled" compact disabled hue={0} saturation={0} onChange={change} />
      </div>
    </div>
    <Text variant="small" tone="muted">Completed wheel gestures: {commits}. Sizes remain 132px / 94px; the host composes luminance and document commands.</Text>
  </section>;
}
