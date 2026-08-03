import React, { useMemo, useState } from 'react';
import {
  formatLightTableDebugLog,
  type LightTableDebugMessage
} from '../debug/debugLog';
import type { TypographyCorpusReport } from '../../text/diagnostics/runTypographyCorpus';
import type { TextRendererBakeoffReport } from '../../text/diagnostics/runTextRendererBakeoff';
import type { TextRenderPresentationSnapshot } from '../../application/rendering/rendererTypes';

interface DebugPanelProps {
  messages: readonly LightTableDebugMessage[];
  onClear: () => void;
  accessoryWidthConstraintsEnabled: boolean;
  editorResizeObserversEnabled: boolean;
  dockResizeActive: boolean;
  onAccessoryWidthConstraintsChange: (enabled: boolean) => void;
  onEditorResizeObserversChange: (enabled: boolean) => void;
  onCaptureRenderTelemetry: () => void;
  onResetRenderTelemetry: () => void;
  textEngineStatus: 'idle' | 'loading' | 'ready' | 'error';
  textEngineSummary: string;
  textEnginePhase: string | null;
  textCorpusReport: TypographyCorpusReport | null;
  textCorpusAvailable: boolean;
  textContractFixtureCount: number;
  lastTextLayoutError: string | null;
  onProbeTextEngine: () => void;
  onRunTextCorpus: () => void;
  textRendererStatus: 'idle' | 'loading' | 'ready' | 'error';
  textRendererPhase: string | null;
  textRendererReport: TextRendererBakeoffReport | null;
  onRunTextRendererBakeoff: () => void;
  developmentTextFixtureEnabled: boolean;
  developmentTextFixtureStatus: 'off' | 'preparing' | 'ready' | 'error';
  developmentTextFixtureError: string | null;
  textSourceMode: 'placeholder' | 'atlas' | 'cached';
  readyTextSourceCount: number;
  textRenderTelemetry: TextRenderPresentationSnapshot;
  onDevelopmentTextFixtureChange: (enabled: boolean) => void;
}

const formatTimestamp = (timestamp: number) => new Date(timestamp).toLocaleTimeString(
  undefined,
  { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 }
);

export const DebugPanel: React.FC<DebugPanelProps> = ({
  messages,
  onClear,
  accessoryWidthConstraintsEnabled,
  editorResizeObserversEnabled,
  dockResizeActive,
  onAccessoryWidthConstraintsChange,
  onEditorResizeObserversChange,
  onCaptureRenderTelemetry,
  onResetRenderTelemetry,
  textEngineStatus,
  textEngineSummary,
  textEnginePhase,
  textCorpusReport,
  textCorpusAvailable,
  textContractFixtureCount,
  lastTextLayoutError,
  onProbeTextEngine,
  onRunTextCorpus,
  textRendererStatus,
  textRendererPhase,
  textRendererReport,
  onRunTextRendererBakeoff,
  developmentTextFixtureEnabled,
  developmentTextFixtureStatus,
  developmentTextFixtureError,
  textSourceMode,
  readyTextSourceCount,
  textRenderTelemetry,
  onDevelopmentTextFixtureChange
}) => {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [rendererView, setRendererView] = useState<'coverage-atlas' | 'hb-gpu' | 'side-by-side'>('side-by-side');
  const summary = useMemo(() => ({
    warnings: messages.filter((entry) => entry.severity === 'warning').length,
    errors: messages.filter((entry) => entry.severity === 'error').length
  }), [messages]);

  const copyAll = async () => {
    const text = formatLightTableDebugLog(messages);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable.');
      await navigator.clipboard.writeText(text);
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1600);
    } catch {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand('copy');
        textarea.remove();
        if (!copied) throw new Error('Copy command failed.');
        setCopyState('copied');
        window.setTimeout(() => setCopyState('idle'), 1600);
      } catch {
        setCopyState('failed');
      }
    }
  };

  return (
    <section className="lighttable-debug-panel" aria-label="LightTable debug log">
      <fieldset className="lighttable-debug-panel__diagnostics">
        <legend>Layout diagnostics</legend>
        <label>
          <input
            type="checkbox"
            checked={accessoryWidthConstraintsEnabled}
            onChange={(event) => onAccessoryWidthConstraintsChange(event.currentTarget.checked)}
          />
          Accessory width constraints (250–520 px)
        </label>
        <label>
          <input
            type="checkbox"
            checked={editorResizeObserversEnabled}
            onChange={(event) => onEditorResizeObserversChange(event.currentTarget.checked)}
          />
          Continuous editor ResizeObservers (viewport + scopes)
        </label>
        <small>
          Dockview auto-resizing remains enabled. Editor observers pause automatically during panel resize.
          {dockResizeActive ? ' Currently paused.' : ''}
        </small>
        <div className="lighttable-debug-panel__actions">
          <button type="button" onClick={onCaptureRenderTelemetry}>Capture render stats</button>
          <button type="button" onClick={onResetRenderTelemetry}>Reset render stats</button>
        </div>
      </fieldset>
      <fieldset className="lighttable-debug-panel__diagnostics">
        <legend>Text engine</legend>
        <small role="status">{textEngineSummary}</small>
        {textEnginePhase ? <small role="status">Phase: {textEnginePhase}</small> : null}
        <small>Contract fixtures: {textContractFixtureCount} (flow + positioned).</small>
        <small>Last layout error: {lastTextLayoutError ?? 'None.'}</small>
        {textCorpusReport ? (
          <details>
            <summary>Typography corpus metrics</summary>
            <dl>
              <dt>Cold roundtrip</dt><dd>{textCorpusReport.coldRoundTripMs.toFixed(2)} ms</dd>
              <dt>WASM initialization</dt><dd>{textCorpusReport.wasmInitializationMs.toFixed(2)} ms</dd>
              <dt>Font registration</dt><dd>{textCorpusReport.fontRegistrationMs.toFixed(2)} ms</dd>
              <dt>First corpus</dt><dd>{textCorpusReport.firstCorpusLayoutMs.toFixed(2)} ms</dd>
              <dt>Warm median / p95</dt>
              <dd>{textCorpusReport.warmCorpusMedianMs.toFixed(2)} / {textCorpusReport.warmCorpusP95Ms.toFixed(2)} ms</dd>
              <dt>Transfer</dt><dd>{textCorpusReport.responseTransferBytes} bytes</dd>
              <dt>WASM linear memory</dt><dd>{textCorpusReport.wasmLinearMemoryBytes} bytes</dd>
            </dl>
            <ul>
              {textCorpusReport.cases.map((entry) => (
                <li key={entry.id}>{entry.passed ? 'Pass' : 'Fail'}: {entry.id} ({entry.glyphCount} glyphs)</li>
              ))}
            </ul>
          </details>
        ) : null}
        <div className="lighttable-debug-panel__actions">
          <button
            type="button"
            onClick={onProbeTextEngine}
            disabled={textEngineStatus === 'loading'}
          >
            {textEngineStatus === 'loading' ? 'Loading text engine...' : 'Probe text engine'}
          </button>
          <button
            type="button"
            onClick={onRunTextCorpus}
            disabled={textEngineStatus === 'loading' || !textCorpusAvailable}
            title={textCorpusAvailable ? undefined : 'Corpus fixtures are development-only.'}
          >
            Run typography corpus
          </button>
          <button
            type="button"
            onClick={onRunTextRendererBakeoff}
            disabled={textRendererStatus === 'loading' || !textCorpusAvailable}
            title={textCorpusAvailable ? undefined : 'Renderer fixtures are development-only.'}
          >
            {textRendererStatus === 'loading' ? 'Running renderer bakeoff...' : 'Run renderer bakeoff'}
          </button>
        </div>
        {textRendererPhase ? <small role="status">Renderer: {textRendererPhase}</small> : null}
        <label>
          <input
            type="checkbox"
            checked={developmentTextFixtureEnabled}
            disabled={!textCorpusAvailable || developmentTextFixtureStatus === 'preparing'}
            onChange={(event) => onDevelopmentTextFixtureChange(event.currentTarget.checked)}
          />
          Show fixed coverage-atlas text on canvas (development only)
        </label>
        <small role="status">
          Canvas fixture: {developmentTextFixtureStatus}
          {developmentTextFixtureError ? ` — ${developmentTextFixtureError}` : ''}
        </small>
        <small>
          Text source: {textSourceMode} · {readyTextSourceCount} ready layer{readyTextSourceCount === 1 ? '' : 's'}
        </small>
        <small>
          Modes: {textRenderTelemetry.atlasLayerCount} atlas / {textRenderTelemetry.cachedLayerCount} cached
          {' · '}{textRenderTelemetry.rebuildingLayerCount} rebuilding
        </small>
        <small>
          Text cache: {(textRenderTelemetry.textureBytes / 1048576).toFixed(1)} / {(textRenderTelemetry.cacheBudgetBytes / 1048576).toFixed(0)} MiB
          {' · '}{textRenderTelemetry.cacheEvictions} evictions
          {' · '}{textRenderTelemetry.sourceCacheHits} hits / {textRenderTelemetry.sourceCacheMisses} misses
        </small>
        <small>
          Layout cache: {(textRenderTelemetry.layoutCacheBytes / 1048576).toFixed(1)} / {(textRenderTelemetry.layoutCacheBudgetBytes / 1048576).toFixed(0)} MiB
          {' · '}{textRenderTelemetry.layoutCacheHits} hits / {textRenderTelemetry.layoutCacheMisses} misses
        </small>
        <small>
          Atlas: {(textRenderTelemetry.atlasBytes / 1048576).toFixed(1)} MiB
          {' · '}{textRenderTelemetry.atlasHits} hits / {textRenderTelemetry.atlasMisses} misses
          {' · '}{textRenderTelemetry.atlasEncodes} direct encodes
          {textRenderTelemetry.lastSourceDecision ? ` · ${textRenderTelemetry.lastSourceDecision}` : ''}
        </small>
        <small>
          Text work: {textRenderTelemetry.shapingOperations} shapes ({textRenderTelemetry.latestShapingRoundTripMs.toFixed(2)} ms latest)
          {' · '}{textRenderTelemetry.rasterizedGlyphs} rasterized ({textRenderTelemetry.latestRasterRoundTripMs.toFixed(2)} ms latest)
          {' · '}{textRenderTelemetry.textCacheSubmissions} cache submits
        </small>
        <small>
          Text input: {textRenderTelemetry.textInputLatencySamples} samples
          {' · '}submit p95 {textRenderTelemetry.inputToSubmitP95Ms.toFixed(1)} ms
          {' / '}max {textRenderTelemetry.inputToSubmitMaxMs.toFixed(1)} ms
          {' · '}GPU p95 {textRenderTelemetry.inputToGpuP95Ms.toFixed(1)} ms
          {' / '}max {textRenderTelemetry.inputToGpuMaxMs.toFixed(1)} ms
          {' · '}{textRenderTelemetry.pendingTextInputs} pending
          {' / '}{textRenderTelemetry.supersededTextInputs} superseded
        </small>
        {textRendererReport ? (
          <details>
            <summary>GPU renderer bakeoff report</summary>
            <label>
              Renderer view
              <select
                value={rendererView}
                onChange={(event) => setRendererView(event.currentTarget.value as typeof rendererView)}
              >
                <option value="coverage-atlas">Coverage atlas</option>
                <option value="hb-gpu">hb-gpu</option>
                <option value="side-by-side">Side by side</option>
              </select>
            </label>
            <dl>
              <dt>Coverage atlas</dt><dd>{textRendererReport.decision.coverageAtlas}</dd>
              <dt>hb-gpu</dt><dd>{textRendererReport.decision.hbGpu}</dd>
              <dt>Production default</dt><dd>{textRendererReport.decision.productionDefault}</dd>
              <dt>Adapter</dt><dd>{textRendererReport.adapter}</dd>
              <dt>Scenarios</dt><dd>{textRendererReport.measurements.length}</dd>
            </dl>
            <pre>{JSON.stringify({
              ...textRendererReport,
              measurements: rendererView === 'side-by-side'
                ? textRendererReport.measurements
                : textRendererReport.measurements.filter((entry) => entry.candidate === rendererView)
            }, null, 2)}</pre>
          </details>
        ) : null}
      </fieldset>
      <header className="lighttable-debug-panel__toolbar">
        <span className="lighttable-debug-panel__summary">
          {messages.length} messages · {summary.warnings} warnings · {summary.errors} errors
        </span>
        <div className="lighttable-debug-panel__actions">
          <button type="button" onClick={onClear} disabled={!messages.length}>Clear</button>
          <button type="button" onClick={() => void copyAll()} disabled={!messages.length}>
            {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy all'}
          </button>
        </div>
      </header>
      <div className="lighttable-debug-panel__messages" role="log" aria-live="polite">
        {messages.length ? messages.map((entry) => (
          <article
            key={entry.id}
            className={`lighttable-debug-message lighttable-debug-message--${entry.severity}`}
          >
            <div className="lighttable-debug-message__header">
              <time dateTime={new Date(entry.timestamp).toISOString()}>
                {formatTimestamp(entry.timestamp)}
              </time>
              <span>{entry.severity}</span>
              <strong>{entry.source}</strong>
            </div>
            <div className="lighttable-debug-message__body">{entry.message}</div>
            {entry.details ? <pre>{entry.details}</pre> : null}
          </article>
        )) : (
          <div className="lighttable-debug-panel__empty">No debug messages in this session.</div>
        )}
      </div>
    </section>
  );
};
