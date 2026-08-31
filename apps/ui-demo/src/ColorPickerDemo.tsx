import React from 'react';
import { ColorArea, ColorPicker, ColorSwatches, IconButton, TextInput, Text,
  colorPickerHex, type ColorPickerColor } from '@lighttable/ui';

const documentColors = ['#D45757', '#E7C25E', '#54A66D', '#5C83BD', '#9C64B0', '#181818', '#B5BDC7', '#FFFFFF'].map(color => ({ color }));

export function ColorPickerDemo() {
  const [value, setValue] = React.useState<ColorPickerColor>({ r: 0.65, g: 0.2, b: 0.7, a: 1 });
  const [opacity, setOpacity] = React.useState(1);
  const [palette, setPalette] = React.useState<readonly string[]>([]);
  const [area, setArea] = React.useState({ s: 0.5, v: 0.75 });
  const [field, setField] = React.useState('Editable value');
  return <>
    <header className="demo-intro">
      <Text as="h1" variant="large" weight="bold">Color picker</Text>
      <Text as="p" tone="muted">One composite, shared controls. The host supplies document colors, palette storage and screen sampling.</Text>
    </header>
    <section className="demo-section">
      <Text as="h2" variant="large" weight="bold">Popover · 320 px</Text>
      <ColorPicker value={value} onChange={setValue} opacity={opacity} onOpacityChange={setOpacity}
        documentColors={documentColors} palette={palette} onPaletteChange={setPalette}
        onSample={async () => '#54A66D'} />
      <Text as="p" variant="small" tone="muted">{colorPickerHex(value)} · Sample uses a fixed demo color. Right-click a palette color to remove it.</Text>
    </section>
    <section className="demo-section">
      <Text as="h2" variant="large" weight="bold">Panel · follows available width</Text>
      <div className="demo-color-panel">
        <ColorPicker variant="panel" value={value} onChange={setValue}
          documentColors={documentColors} palette={palette} onPaletteChange={setPalette} />
      </div>
      <Text as="p" variant="small" tone="muted">Resize the example. The plane keeps its 1.55:1 ratio; swatches stay 28 × 28 px with 6 px gaps.</Text>
    </section>
    <section className="demo-section">
      <Text as="h2" variant="large" weight="bold">Building blocks</Text>
      <div className="demo-slider-examples">
        <ColorArea hue={285} value={area} onChange={setArea} />
        <ColorSwatches colors={documentColors} onSelect={setField} />
        <TextInput aria-label="Example text field" value={field} onChange={event => setField(event.target.value)} />
        <TextInput aria-label="Disabled text field" value="Disabled" disabled />
        <IconButton icon="+" aria-label="Reset example field" onClick={() => setField('Editable value')} />
      </div>
      <pre className="demo-code"><Text as="code">{'<ColorPicker value={color} onChange={setColor}\n  documentColors={documentColors}\n  palette={palette} onPaletteChange={setPalette} />'}</Text></pre>
    </section>
  </>;
}
