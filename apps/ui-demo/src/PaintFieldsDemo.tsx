import React from 'react';
import { PaintField, GradientField, NonePaintField, ColorPicker, GradientEditor, Text,
  colorPickerHex, type GradientValue, type ColorPickerColor } from '@lighttable/ui';

const initialGradient: GradientValue = {
  colorStops: [
    { id: 'black', position: 0, midpoint: 0.5, color: { r: 0, g: 0, b: 0, a: 1 } },
    { id: 'white', position: 1, midpoint: 0.5, color: { r: 1, g: 1, b: 1, a: 1 } }
  ],
  opacityStops: [{ id: 'start', position: 0, midpoint: 0.5, opacity: 1 },
    { id: 'end', position: 1, midpoint: 0.5, opacity: 1 }]
};

export function PaintFieldsDemo() {
  const [color, setColor] = React.useState<ColorPickerColor>({ r: 0.85, g: 0.24, b: 0.24, a: 1 });
  const [gradient, setGradient] = React.useState(initialGradient);
  const [editor, setEditor] = React.useState<'color' | 'gradient' | null>(null);
  const toggle = (next: 'color' | 'gradient') => setEditor(current => current === next ? null : next);
  return <section className="demo-section">
    <Text as="h2" variant="large" weight="bold">Paint fields · 72 × 28 px</Text>
    <Text as="p" tone="muted">One size for all paint fields. The complete preview and chevron open the same editor; the pipette is a separate action.</Text>
    <div className="demo-themes">
      <PaintField kind="color" value={colorPickerHex(color)} ariaLabel="Color paint"
        expanded={editor === 'color'} onClick={() => toggle('color')} />
      <GradientField value={gradient} ariaLabel="Gradient paint"
        expanded={editor === 'gradient'} onClick={() => toggle('gradient')} />
      <NonePaintField ariaLabel="No paint" onClick={() => toggle('color')} />
    </div>
    <div className="demo-themes">
      <Text>Picker + pipette</Text>
      <PaintField kind="color" value={colorPickerHex(color)} ariaLabel="Sampled color"
        expanded={editor === 'color'} onClick={() => toggle('color')}
        onSample={() => setColor({ r: 0.33, g: 0.65, b: 0.43, a: 1 })} />
      <PaintField kind="color" value={colorPickerHex(color)} ariaLabel="Disabled paint" disabled onClick={() => toggle('color')} />
    </div>
    {editor && <div className="demo-color-panel">
      <Text as="p" variant="small" tone="muted">Host-owned {editor} editor. This specimen opens inline; LightTable anchors the same controls in its existing popup.</Text>
      {editor === 'color' ? <ColorPicker variant="panel" value={color} onChange={setColor} />
        : <GradientEditor value={gradient} onChange={setGradient} />}
    </div>}
    <pre className="demo-code"><Text as="code">{'<PaintField kind="color" value="#D83D3D" ariaLabel="Fill"\n  expanded={open} onClick={togglePicker} />'}</Text></pre>
  </section>;
}
