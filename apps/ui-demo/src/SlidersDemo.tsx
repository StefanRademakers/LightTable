import React, { useState } from 'react';
import { Button, GradientEditor, RangeSlider, Slider, SliderField, Text, type GradientValue } from '@lighttable/ui';

const initialGradient: GradientValue = {
  colorStops: [
    { id: 'a', position: 0, midpoint: 0.5, color: { r: 0.12, g: 0.38, b: 0.85, a: 1 } },
    { id: 'b', position: 1, midpoint: 0.5, color: { r: 1, g: 0.28, b: 0.32, a: 1 } }
  ],
  opacityStops: [{ id: 'oa', position: 0, midpoint: 0.5, opacity: 1 }, { id: 'ob', position: 1, midpoint: 0.5, opacity: 1 }]
};
export function SlidersDemo() {
  const [value, setValue] = useState(36);
  const [opacity, setOpacity] = useState(100);
  const [range, setRange] = useState<readonly number[]>([20, 80]);
  const [levels, setLevels] = useState<readonly number[]>([12, 128, 242]);
  const [gradient, setGradient] = useState(initialGradient);
  const [gradientStarts, setGradientStarts] = useState(0);
  const [gradientCommits, setGradientCommits] = useState(0);
  const [commits, setCommits] = useState(0);
  const [starts, setStarts] = useState(0);
  const [previews, setPreviews] = useState(0);
  const [slow, setSlow] = useState(0);
  const [interval, setInterval] = useState(33);
  const [disabled, setDisabled] = useState(false);
  return <>
    <header className="demo-intro"><Text as="h1" variant="large" weight="bold">Sliders &amp; gradients</Text>
      <Text as="p" tone="muted">One slider interaction, composed fields, coupled ranges and editable gradient stops.</Text></header>
    <section className="demo-section"><Text as="h2" variant="large" weight="bold">Slider / SliderField</Text>
      <div className="demo-slider-examples">
        <Slider label="Bare slider" value={value} min={0} max={100} onChange={setValue} disabled={disabled} />
        <SliderField label="Color" value={value} min={0} max={100} onChange={setValue} disabled={disabled} />
        <SliderField label="Opacity" layout="inline" size="small" value={opacity} min={0} max={100}
          resetValue={100} format={v => `${v}%`} onChange={setOpacity} disabled={disabled} />
        <SliderField label="Exposure" value={slow} min={-5} max={5} step={0.01} resetValue={0}
          format={v => `${v.toFixed(2)} EV`} onChange={v => { setSlow(v); setPreviews(n => n + 1); }}
          onInteractionStart={() => setStarts(n => n + 1)} onInteractionEnd={() => setCommits(n => n + 1)}
          publishIntervalMs={interval} disabled={disabled} />
        <SliderField label="Hue" value={value * 3.6} min={0} max={360} format={v => `${Math.round(v)}°`}
          onChange={v => setValue(v / 3.6)} showResetMarker={false} disabled={disabled}
          trackBackground="linear-gradient(to right, red, yellow, lime, cyan, blue, magenta, red)" />
        <SliderField label="Alpha" value={opacity} min={0} max={100} format={v => `${v}%`} resetValue={100}
          transparency trackBackground="linear-gradient(to right, transparent, #28569b)" onChange={setOpacity} disabled={disabled} />
      </div>
      <div className="demo-button-row"><Button onClick={() => setDisabled(v => !v)}>{disabled ? 'Enable sliders' : 'Disable sliders'}</Button>
        <Button onClick={() => setInterval(v => v === 33 ? 500 : 33)}>Preview: {interval} ms</Button>
        <Button onClick={() => { setSlow(0); setValue(36); setOpacity(100); }}>External reset</Button></div>
      <Text as="p" variant="small" tone="muted">Exposure: starts {starts} · previews {previews} · commits {commits}. At 500 ms the handle and readout still move immediately. Release flushes the final value.</Text>
      <Text as="p" variant="small" tone="muted">Double-click a label/value to reset; Shift-click also resets. No Tab stop in app chrome; dialogs opt in with tabIndex.</Text>
    </section>
    <section className="demo-section"><Text as="h2" variant="large" weight="bold">RangeSlider</Text>
      <div className="demo-slider-examples">
        <RangeSlider label="Output range" values={range} labels={['Range minimum', 'Range maximum']} min={0} max={100}
          onChange={setRange} renderValues={v => v.map((n, i) => <Text key={i} variant="small">{Math.round(n)}</Text>)} />
        <RangeSlider label="Three coupled handles" values={levels} labels={['Black point', 'Midpoint', 'White point']} min={0} max={255}
          trackBackground="linear-gradient(to right, black, white)" onChange={setLevels}
          getBounds={(i, v) => i === 0 ? { min: 0, max: v[2]! - 1 } : i === 2 ? { min: v[0]! + 1, max: 255 } : { min: v[0]!, max: v[2]! }}
          resolveValues={(next, i, previous) => i === 1 ? next : [next[0]!, next[0]! + (next[2]! - next[0]!) * ((previous[1]! - previous[0]!) / (previous[2]! - previous[0]!)), next[2]!]}
          renderValues={v => v.map((n, i) => <Text key={i} variant="small">{Math.round(n)}</Text>)} />
      </div>
      <Text as="p" tone="muted">Constraints and coupling are supplied by the app. Pointer and keyboard use the same limits.</Text>
    </section>
    <section className="demo-section"><Text as="h2" variant="large" weight="bold">GradientEditor</Text>
      <div className="demo-slider-examples"><GradientEditor value={gradient} onChange={setGradient}
        onInteractionStart={() => setGradientStarts(n => n + 1)} onInteractionEnd={() => setGradientCommits(n => n + 1)} /></div>
      <Text as="p" variant="small" tone="muted">Gradient: starts {gradientStarts} · commits {gradientCommits}.</Text>
      <Text as="p" tone="muted">Click above/below the ramp to add stops. Drag stops and midpoints; right-click or Delete removes a stop. At least two stops remain per track.</Text>
      <Text as="p" variant="small" tone="muted">The package includes a native color field; LightTable supplies its existing color picker through renderColorField. Asset IDs, interpolation settings and document history remain app-owned.</Text>
    </section>
  </>;
}
