import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { LightTableDebugMessage } from '../debug/debugLog';
import { DebugPanel } from './DebugPanel';

const renderPanel = (
  status: 'idle' | 'loading' | 'ready' | 'error',
  summary: string,
  messages: readonly LightTableDebugMessage[] = []
) =>
  renderToStaticMarkup(<DebugPanel
    messages={messages}
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
    textRendererStatus="idle"
    textRendererPhase={null}
    textRendererReport={null}
    onRunTextRendererBakeoff={vi.fn()}
    developmentTextFixtureEnabled={false}
    developmentTextFixtureStatus="off"
    developmentTextFixtureError={null}
    textSourceMode="placeholder"
    readyTextSourceCount={0}
    textRenderTelemetry={{
      publicationRevision: 0, readyLayerCount: 0, textureBytes: 0, mode: 'placeholder',
      rebuildingLayerCount: 0, cacheBudgetBytes: 268435456, cacheEvictions: 0,
      atlasLayerCount: 0, cachedLayerCount: 0, atlasEncodes: 0,
      sourceCacheHits: 0, sourceCacheMisses: 0,
      layoutCacheBytes: 0, layoutCacheBudgetBytes: 33554432,
      layoutCacheHits: 0, layoutCacheMisses: 0, layoutCacheEvictions: 0,
      atlasBytes: 0, atlasHits: 0, atlasMisses: 0, atlasEvictions: 0,
      sourceDecisionMeasurements: 0, lastSourceDecision: null,
      coordinatorActive: true, configuredFontCount: 1, visibleTextLayerCount: 1,
      preparationStage: 'shaping', preparationLayerId: 'text-1', lastPreparationError: null,
      traceRevision: 1, traceMessage: 'Text shaping', traceDetails: 'layer=text-1',
      shapingOperations: 0, latestShapingRoundTripMs: 0,
      rasterizedGlyphs: 0, latestRasterRoundTripMs: 0, textCacheSubmissions: 0,
      textInputLatencySamples: 2, pendingTextInputs: 1, supersededTextInputs: 3,
      inputToSubmitP95Ms: 11, inputToSubmitMaxMs: 14,
      inputToGpuP95Ms: 18, inputToGpuMaxMs: 22
    }}
    onDevelopmentTextFixtureChange={vi.fn()}
  />);

describe('DebugPanel text engine diagnostic', () => {
  it('presents the lazy idle state without implying the engine is loaded', () => {
    const markup = renderPanel('idle', 'Not loaded.');
    expect(markup).toContain('Text engine');
    expect(markup).toContain('Not loaded.');
    expect(markup).toContain('Probe text engine');
    expect(markup).toContain('Run typography corpus');
    expect(markup).toContain('Run renderer bakeoff');
    expect(markup).toContain('Show fixed coverage-atlas text on canvas');
    expect(markup).toContain('<input type="checkbox"/>Show fixed coverage-atlas text on canvas');
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

  it('bounds rendered log rows while retaining the full copyable message set', () => {
    const messages = Array.from({ length: 105 }, (_, index): LightTableDebugMessage => ({
      id: index,
      timestamp: index,
      severity: 'info',
      source: 'Stress',
      message: `Message ${index}`
    }));
    const markup = renderPanel('idle', 'Not loaded.', messages);
    expect(markup).toContain('5 older messages remain available through Copy all.');
    expect(markup.match(/class="lighttable-debug-message /g)).toHaveLength(100);
    expect(markup).not.toContain('Message 4<');
    expect(markup).toContain('Message 104<');
  });
});
