import { useCallback, useEffect, useRef, useState } from 'react';
import { lightTableTextEngine, TextLayoutRuntimeError } from '../wasm/TextEngineClient';
import { runTypographyCorpus, type TypographyCorpusReport } from './runTypographyCorpus';

export interface TextEngineDiagnosticState {
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly summary: string;
  readonly phase: string | null;
  readonly lastLayoutError: string | null;
  readonly report: TypographyCorpusReport | null;
  readonly corpusAvailable: boolean;
}

type AppendDiagnostic = (
  severity: 'info' | 'warning' | 'error',
  source: string,
  message: string,
  details?: string
) => void;

const initialState: TextEngineDiagnosticState = {
  status: 'idle',
  summary: 'Not loaded. The worker and WASM remain lazy until probed.',
  phase: null,
  lastLayoutError: null,
  report: null,
  corpusAvailable: import.meta.env.DEV
};
const reportDetails = (report: TypographyCorpusReport) => [
  `Cold roundtrip: ${report.coldRoundTripMs.toFixed(2)} ms`,
  `WASM initialization: ${report.wasmInitializationMs.toFixed(2)} ms`,
  `Font registration: ${report.fontRegistrationMs.toFixed(2)} ms`,
  `First corpus: ${report.firstCorpusLayoutMs.toFixed(2)} ms`,
  `Warm median/p95: ${report.warmCorpusMedianMs.toFixed(2)} / ${report.warmCorpusP95Ms.toFixed(2)} ms`,
  `Transfer: ${report.responseTransferBytes} bytes`,
  `WASM linear memory: ${report.wasmLinearMemoryBytes} bytes`,
  '',
  ...report.cases.map((entry) => `${entry.passed ? 'PASS' : 'FAIL'} ${entry.id} — ${entry.passed
    ? `${entry.glyphCount} glyphs, ${entry.lineCount} lines, ${entry.structuralHash.slice(0, 12)}`
    : entry.error}`)
].join('\n');

export const useTextEngineDiagnostics = (append: AppendDiagnostic) => {
  const [state, setState] = useState<TextEngineDiagnosticState>(initialState);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const probe = useCallback(() => {
    setState((current) => ({ ...current, status: 'loading', phase: 'Loading text WASM', summary: 'Loading Rust/WASM text engine...' }));
    void lightTableTextEngine.probe().then((capability) => {
      const summary = `Ready: v${capability.engineVersion} in ${capability.loadDurationMs.toFixed(1)} ms.`;
      setState((current) => ({ ...current, status: 'ready', phase: null, summary }));
      append('info', 'Text engine', summary);
    }).catch((reason: unknown) => {
      const message = reason instanceof Error ? reason.message : 'The text engine capability probe failed.';
      setState((current) => ({ ...current, status: 'error', phase: null, summary: message }));
      append('error', 'Text engine', message);
    });
  }, [append]);

  const runCorpus = useCallback(() => {
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    setState((current) => ({
      ...current, status: 'loading', phase: 'Loading corpus fixtures',
      summary: 'Running the fixed typography corpus...', lastLayoutError: null
    }));
    void (async () => {
      if (!import.meta.env.DEV) throw new Error('Typography corpus fixtures are available only in development builds.');
      const { loadTypographyCorpusFixtureBytes } = await import('./typographyCorpusFixtures.dev');
      const bytes = await loadTypographyCorpusFixtureBytes();
      return runTypographyCorpus(
        lightTableTextEngine,
        bytes,
        (phase) => setState((current) => ({ ...current, phase })),
        abort.signal
      );
    })().then((report) => {
      const failed = report.cases.filter((entry) => !entry.passed);
      const summary = `${report.cases.length - failed.length} passed · ${failed.length} failed · warm p95 ${report.warmCorpusP95Ms.toFixed(1)} ms.`;
      const details = reportDetails(report);
      setState((current) => ({
        ...current, status: failed.length ? 'error' : 'ready', phase: null, summary, report,
        lastLayoutError: failed[0]?.error ?? null
      }));
      append(failed.length ? 'error' : 'info', 'Typography corpus', summary, details);
    }).catch((reason: unknown) => {
      if (abort.signal.aborted) return;
      const message = reason instanceof Error ? reason.message : 'Typography corpus failed.';
      const lastLayoutError = reason instanceof TextLayoutRuntimeError
        ? `${reason.layoutError.code}: ${reason.layoutError.message}`
        : message;
      setState((current) => ({
        ...current, status: 'error', phase: null, summary: message, lastLayoutError
      }));
      append('error', 'Typography corpus', message);
    });
  }, [append]);

  return { state, probe, runCorpus };
};
