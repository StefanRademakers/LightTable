import { Histogram, ScopesPanel, Text, type RgbHistogram, type ScopeVisibility, type VectorscopeRange } from '@lighttable/ui';
import React, { useEffect, useRef, useState } from 'react';
import { renderScopeFixtures } from './scopeFixtures';

const histogram: RgbHistogram = {
  red: Uint32Array.from({ length: 256 }, (_, x) => 600 * Math.exp(-1 * ((x - 182) / 27) ** 2) + 180 * Math.exp(-1 * ((x - 92) / 34) ** 2)),
  green: Uint32Array.from({ length: 256 }, (_, x) => 800 * Math.exp(-1 * ((x - 154) / 18) ** 2) + 280 * Math.exp(-1 * ((x - 76) / 35) ** 2)),
  blue: Uint32Array.from({ length: 256 }, (_, x) => 680 * Math.exp(-1 * ((x - 105) / 20) ** 2) + 220 * Math.exp(-1 * ((x - 43) / 25) ** 2))
};
const targets = [
  { label: 'R', x: 0.414, y: 0.125 }, { label: 'Mg', x: 0.789, y: 0.159 },
  { label: 'B', x: 0.875, y: 0.534 }, { label: 'Cy', x: 0.586, y: 0.875 },
  { label: 'G', x: 0.211, y: 0.841 }, { label: 'Yl', x: 0.125, y: 0.466 }
];

export function ScopesDemo() {
  const containerRef = useRef<HTMLElement>(null);
  const hue = useRef<HTMLCanvasElement>(null);
  const parade = useRef<HTMLCanvasElement>(null);
  const vector = useRef<HTMLCanvasElement>(null);
  const [visibility, setVisibility] = useState<ScopeVisibility>({ histogram: true, hueDistribution: true, parade: true, vectorscope: true });
  const [range, setRange] = useState<VectorscopeRange>('all');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!hue.current || !parade.current || !vector.current) return;
    return renderScopeFixtures([hue.current, parade.current, vector.current], range, setError);
  }, [range]);
  return <>
    <header className="demo-intro">
      <Text as="h1" variant="large" weight="bold">Scopes</Text>
      <Text as="p" tone="muted">Shared histogram, scales and overlays. GPU plots use the production display shaders with static demonstration data; image analysis stays in the host app.</Text>
    </header>
    <section className="demo-section demo-scopes-layout">
      <div className="demo-scopes-panel">
        <ScopesPanel containerRef={containerRef} visibility={visibility} range={range} histogram={histogram}
          hueDistributionCanvasRef={hue} paradeCanvasRef={parade} vectorscopeCanvasRef={vector}
          targets={targets} skinEnd={{ x: 0.249, y: 0.114 }} error={error}
          onRangeChange={setRange} onVisibilityChange={(key, value) => setVisibility(previous => ({ ...previous, [key]: value }))} />
      </div>
      <div className="demo-section">
        <Text weight="bold">Embedded histogram</Text>
        <Text as="p" tone="muted">The same control in Grade and Levels. Drag/clipping controls are supplied by the editor.</Text>
        <Histogram histogram={histogram} />
        <Text variant="small" tone="muted">Collapse/reopen a section or change theme: canvas nodes and the displayed data are retained.</Text>
      </div>
    </section>
  </>;
}
