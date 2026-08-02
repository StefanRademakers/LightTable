import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DebugPanel } from './DebugPanel';

const renderPanel = (status: 'idle' | 'loading' | 'ready' | 'error', summary: string) =>
  renderToStaticMarkup(<DebugPanel
    messages={[]}
    onClear={vi.fn()}
    accessoryWidthConstraintsEnabled
    editorResizeObserversEnabled
    dockResizeActive={false}
    onAccessoryWidthConstraintsChange={vi.fn()}
    onEditorResizeObserversChange={vi.fn()}
    onCaptureRenderTelemetry={vi.fn()}
    onResetRenderTelemetry={vi.fn()}
    textEngineStatus={status}
    textEngineSummary={summary}
    textEnginePhase={status === 'loading' ? 'Registering fonts' : null}
    textCorpusReport={null}
    textCorpusAvailable
    textContractFixtureCount={2}
    lastTextLayoutError={null}
    onProbeTextEngine={vi.fn()}
    onRunTextCorpus={vi.fn()}
  />);

describe('DebugPanel text engine diagnostic', () => {
  it('presents the lazy idle state without implying the engine is loaded', () => {
    const markup = renderPanel('idle', 'Not loaded.');
    expect(markup).toContain('Text engine');
    expect(markup).toContain('Not loaded.');
    expect(markup).toContain('Probe text engine');
    expect(markup).toContain('Run typography corpus');
    expect(markup).toContain('Contract fixtures: 2');
    expect(markup).toContain('Last layout error: None.');
  });

  it('disables the probe while the engine is loading', () => {
    const markup = renderPanel('loading', 'Loading Rust/WASM text engine...');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('Loading text engine');
    expect(markup).toContain('Phase: Registering fonts');
  });

  it('shows ready and failure details', () => {
    expect(renderPanel('ready', 'Ready: v0.1.0 in 4.5 ms.')).toContain('Ready: v0.1.0');
    expect(renderPanel('error', 'WASM unavailable.')).toContain('WASM unavailable.');
  });
});
