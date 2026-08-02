import React, { useMemo, useState } from 'react';
import {
  formatLightTableDebugLog,
  type LightTableDebugMessage
} from '../debug/debugLog';

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
  onProbeTextEngine: () => void;
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
  onProbeTextEngine
}) => {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
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
        <div className="lighttable-debug-panel__actions">
          <button
            type="button"
            onClick={onProbeTextEngine}
            disabled={textEngineStatus === 'loading'}
          >
            {textEngineStatus === 'loading' ? 'Loading text engine...' : 'Probe text engine'}
          </button>
        </div>
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
