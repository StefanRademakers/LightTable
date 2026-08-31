import { Checkbox, Button, PanelSection } from '@lighttable/ui';
import React, { useMemo, useState } from 'react';
import {
  formatLightTableDebugLog,
  type LightTableDebugMessage
} from '../debug/debugLog';
import type { TypographyCorpusReport } from '../../text/diagnostics/runTypographyCorpus';
import type { TextRendererBakeoffReport } from '../../text/diagnostics/runTextRendererBakeoff';
import type { TextRenderPresentationSnapshot } from '../../application/rendering/rendererTypes';
import type { SupportDiagnosticArtifact, SupportDiagnosticOptions } from '../../application/diagnostics/supportDiagnosticBundle';
import type { WebGpuSupportTier } from '../../gpu/webGpuSupportTier';
import { useLocalBetaDiagnostics } from '../hooks/useLocalBetaDiagnostics';
import { Select } from '@lighttable/ui';

interface DebugPanelProps {
  messages: readonly LightTableDebugMessage[];
  onClear: () => void;
  onCollectSupportDiagnostics: (options: SupportDiagnosticOptions) => Promise<SupportDiagnosticArtifact>;
  onExportSupportDiagnostics?: (file: File) => Promise<unknown> | unknown;
  gpuSupport: WebGpuSupportTier | null;
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

const formatFontBytes = (bytes = 0) => bytes < 100 * 1024
  ? `${Math.round(bytes / 1024)} KiB loaded`
  : `${(bytes / (1024 * 1024)).toFixed(1)} MiB loaded`;

export const DebugPanel: React.FC<DebugPanelProps> = ({
  messages,
  onClear,
  onCollectSupportDiagnostics,
  onExportSupportDiagnostics,
  gpuSupport,
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
  const visibleMessages = messages.slice(-100);
  const omittedMessageCount = messages.length - visibleMessages.length;
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [includeFileName, setIncludeFileName] = useState(false);
  const [supportArtifact, setSupportArtifact] = useState<SupportDiagnosticArtifact | null>(null);
  const [supportState, setSupportState] = useState<'idle' | 'collecting' | 'exported' | 'failed'>('idle');
  const [rendererView, setRendererView] = useState<'coverage-atlas' | 'hb-gpu' | 'side-by-side'>('side-by-side');
  const betaDiagnostics = useLocalBetaDiagnostics(messages);
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

  const collectSupportArtifact = async () => {
    setSupportState('collecting');
    try {
      const artifact = await onCollectSupportDiagnostics({ includeFileName, betaDiagnostics: betaDiagnostics.snapshot() });
      setSupportArtifact(artifact);
      setSupportState('idle');
      return artifact;
    } catch {
      setSupportState('failed');
      return null;
    }
  };

  const copySupportSummary = async () => {
    const artifact = supportArtifact ?? await collectSupportArtifact();
    if (!artifact) return;
    try {
      await navigator.clipboard.writeText(artifact.summary);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  const exportSupportBundle = async () => {
    const artifact = await collectSupportArtifact();
    if (!artifact || !onExportSupportDiagnostics) return;
    try {
      await onExportSupportDiagnostics(artifact.file);
      setSupportState('exported');
    } catch {
      setSupportState('failed');
    }
  };

  return (
    <section className="lighttable-debug-panel" aria-label="LightTable debug log">
      <fieldset className="lighttable-debug-panel__diagnostics">
        <legend>Support diagnostics</legend>
        <small>
          Built locally from bounded snapshots. No document pixels, text, binary payloads or network upload.
        </small>
        <small role="status">
          WebGPU support: {gpuSupport?.label ?? 'Not initialized'}. {gpuSupport?.action ?? 'Open a document to probe this device.'}
        </small>
        <label>
          <Checkbox

            checked={betaDiagnostics.enabled}
            onChange={(event) => {
              setSupportArtifact(null);
              betaDiagnostics.setEnabled(event.currentTarget.checked);
            }}
          />
          Record privacy-safe beta events locally
        </label>
        <small>
          Nothing is sent automatically. {betaDiagnostics.eventCount} bounded event(s) stored. Turning this off clears them.
        </small>
        <label>
          <Checkbox

            checked={includeFileName}
            onChange={(event) => {
              setIncludeFileName(event.currentTarget.checked);
              setSupportArtifact(null);
            }}
          />
          Include document filename
        </label>
        <div className="lighttable-debug-panel__actions">
          <Button type="button" onClick={() => void collectSupportArtifact()} disabled={supportState === 'collecting'}>
            {supportState === 'collecting' ? 'Collecting...' : 'Preview'}
          </Button>
          <Button type="button" onClick={() => void copySupportSummary()}>Copy summary</Button>
          <Button type="button" onClick={() => void exportSupportBundle()} disabled={!onExportSupportDiagnostics || supportState === 'collecting'}>
            Export bundle
          </Button>
        </div>
        {supportState === 'exported' ? <small role="status">Diagnostic bundle exported.</small> : null}
        {supportState === 'failed' ? <small role="alert">Diagnostic collection or export failed.</small> : null}
        {supportArtifact ? (
          <PanelSection label={`Redacted preview (${supportArtifact.collectionDurationMs.toFixed(2)} ms)`} defaultExpanded keepMounted>
            <pre className="lighttable-debug-panel__preview">{supportArtifact.json}</pre>
          </PanelSection>
        ) : null}
      </fieldset>
      <fieldset className="lighttable-debug-panel__diagnostics">
        <legend>Development diagnostics</legend>
        <label>
          <Checkbox

            checked={accessoryWidthConstraintsEnabled}
            onChange={(event) => onAccessoryWidthConstraintsChange(event.currentTarget.checked)}
          />
          Accessory width constraints (250–520 px)
        </label>
        <label>
          <Checkbox

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
          <Button type="button" onClick={onCaptureRenderTelemetry}>Capture render stats</Button>
          <Button type="button" onClick={onResetRenderTelemetry}>Reset render stats</Button>
        </div>
      </fieldset>
      <fieldset className="lighttable-debug-panel__diagnostics">
        <legend>Text engine</legend>
        <small role="status">{textEngineSummary}</small>
        {textEnginePhase ? <small role="status">Phase: {textEnginePhase}</small> : null}
        <small>Contract fixtures: {textContractFixtureCount} (flow + positioned).</small>
        <small>Last layout error: {lastTextLayoutError ?? 'None.'}</small>
        {textCorpusReport ? (
          <PanelSection label="Typography corpus metrics" keepMounted>
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
          </PanelSection>
        ) : null}
        <div className="lighttable-debug-panel__actions">
          <Button
            type="button"
            onClick={onProbeTextEngine}
            disabled={textEngineStatus === 'loading'}
          >
            {textEngineStatus === 'loading' ? 'Loading text engine...' : 'Probe text engine'}
          </Button>
          <Button
            type="button"
            onClick={onRunTextCorpus}
            disabled={textEngineStatus === 'loading' || !textCorpusAvailable}
            title={textCorpusAvailable ? undefined : 'Corpus fixtures are development-only.'}
          >
            Run typography corpus
          </Button>
          <Button
            type="button"
            onClick={onRunTextRendererBakeoff}
            disabled={textRendererStatus === 'loading' || !textCorpusAvailable}
            title={textCorpusAvailable ? undefined : 'Renderer fixtures are development-only.'}
          >
            {textRendererStatus === 'loading' ? 'Running renderer bakeoff...' : 'Run renderer bakeoff'}
          </Button>
        </div>
        {textRendererPhase ? <small role="status">Renderer: {textRendererPhase}</small> : null}
        <label>
          <Checkbox

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
        <small role="status">
          Coordinator: {textRenderTelemetry.coordinatorActive ? 'active' : 'suspended'}
          {' · '}{textRenderTelemetry.visibleTextLayerCount} visible text layer{textRenderTelemetry.visibleTextLayerCount === 1 ? '' : 's'}
          {' · '}{textRenderTelemetry.configuredFontCount} font face{textRenderTelemetry.configuredFontCount === 1 ? '' : 's'}
          {' · '}{formatFontBytes(textRenderTelemetry.loadedFontBytes)}
          {' · '}{textRenderTelemetry.preparationStage}
          {textRenderTelemetry.preparationLayerId ? ` (${textRenderTelemetry.preparationLayerId})` : ''}
        </small>
        {textRenderTelemetry.lastPreparationError ? (
          <small role="alert">Text preparation error: {textRenderTelemetry.lastPreparationError}</small>
        ) : null}
        <small role="status">
          Coordinator: {textRenderTelemetry.coordinatorActive ? 'active' : 'suspended'}
          {' · '}{textRenderTelemetry.visibleTextLayerCount} visible text layer{textRenderTelemetry.visibleTextLayerCount === 1 ? '' : 's'}
          {' · '}{textRenderTelemetry.configuredFontCount} font face{textRenderTelemetry.configuredFontCount === 1 ? '' : 's'}
          {' · '}{formatFontBytes(textRenderTelemetry.loadedFontBytes)}
          {' · '}{textRenderTelemetry.preparationStage}
          {textRenderTelemetry.preparationLayerId ? ` (${textRenderTelemetry.preparationLayerId})` : ''}
        </small>
        {textRenderTelemetry.lastPreparationError ? (
          <small role="alert">Text preparation error: {textRenderTelemetry.lastPreparationError}</small>
        ) : null}
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
          <PanelSection label="GPU renderer bakeoff report" keepMounted>
            <label>
              Renderer view
              <Select
                value={rendererView}
                onValueChange={(nextValue) => setRendererView(nextValue as typeof rendererView)}
              >
                <option value="coverage-atlas">Coverage atlas</option>
                <option value="hb-gpu">hb-gpu</option>
                <option value="side-by-side">Side by side</option>
              </Select>
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
          </PanelSection>
        ) : null}
      </fieldset>
      <header className="lighttable-debug-panel__toolbar">
        <span className="lighttable-debug-panel__summary">
          {messages.length} messages · {summary.warnings} warnings · {summary.errors} errors
        </span>
        <div className="lighttable-debug-panel__actions">
          <Button type="button" onClick={onClear} disabled={!messages.length}>Clear</Button>
          <Button type="button" onClick={() => void copyAll()} disabled={!messages.length}>
            {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy all'}
          </Button>
        </div>
      </header>
      <div className="lighttable-debug-panel__messages" role="log" aria-live="polite">
        {omittedMessageCount > 0 ? (
          <div className="lighttable-debug-panel__empty">
            {omittedMessageCount} older messages remain available through Copy all.
          </div>
        ) : null}
        {visibleMessages.length ? visibleMessages.map((entry) => (
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
