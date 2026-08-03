import { useCallback, useEffect, useRef, useState } from 'react';
import { lightTableTextEngine, TextLayoutRuntimeError } from '../wasm/TextEngineClient';
import { runTypographyCorpus, type TypographyCorpusReport } from './runTypographyCorpus';
import type { TextRendererBakeoffReport } from './runTextRendererBakeoff';

export interface TextEngineDiagnosticState {
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly summary: string;
  readonly phase: string | null;
  readonly lastLayoutError: string | null;
  readonly report: TypographyCorpusReport | null;
  readonly corpusAvailable: boolean;
  readonly rendererStatus: 'idle' | 'loading' | 'ready' | 'error';
  readonly rendererPhase: string | null;
  readonly rendererReport: TextRendererBakeoffReport | null;
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
  corpusAvailable: import.meta.env.DEV,
  rendererStatus: 'idle',
  rendererPhase: null,
  rendererReport: null
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
  const corpusAbortRef = useRef<AbortController | null>(null);
  const rendererAbortRef = useRef<AbortController | null>(null);

  useEffect(() => () => {
    corpusAbortRef.current?.abort();
    rendererAbortRef.current?.abort();
  }, []);

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
    corpusAbortRef.current?.abort();
    const abort = new AbortController();
    corpusAbortRef.current = abort;
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
        (phase) => {
          if (corpusAbortRef.current === abort) setState((current) => ({ ...current, phase }));
        },
        abort.signal
      );
    })().then((report) => {
      if (corpusAbortRef.current !== abort) return;
      const failed = report.cases.filter((entry) => !entry.passed);
      const summary = `${report.cases.length - failed.length} passed · ${failed.length} failed · warm p95 ${report.warmCorpusP95Ms.toFixed(1)} ms.`;
      const details = reportDetails(report);
      setState((current) => ({
        ...current, status: failed.length ? 'error' : 'ready', phase: null, summary, report,
        lastLayoutError: failed[0]?.error ?? null
      }));
      append(failed.length ? 'error' : 'info', 'Typography corpus', summary, details);
    }).catch((reason: unknown) => {
      if (corpusAbortRef.current !== abort) return;
      if (abort.signal.aborted) {
        setState((current) => ({ ...current, status: 'idle', phase: null, summary: 'Typography corpus canceled.' }));
        return;
      }
      const message = reason instanceof Error ? reason.message : 'Typography corpus failed.';
      const lastLayoutError = reason instanceof TextLayoutRuntimeError
        ? `${reason.layoutError.code}: ${reason.layoutError.message}`
        : message;
      setState((current) => ({
        ...current, status: 'error', phase: null, summary: message, lastLayoutError
      }));
      append('error', 'Typography corpus', message);
    }).finally(() => {
      if (corpusAbortRef.current === abort) corpusAbortRef.current = null;
    });
  }, [append]);

  const runRendererBakeoff = useCallback(() => {
    rendererAbortRef.current?.abort();
    const abort = new AbortController();
    rendererAbortRef.current = abort;
    setState((current) => ({
      ...current, rendererStatus: 'loading', rendererPhase: 'Loading fixed renderer fixtures',
      summary: 'Running the bounded GPU text renderer bakeoff...'
    }));
    void (async () => {
      if (!import.meta.env.DEV) throw new Error('Renderer bakeoff fixtures are development-only.');
      const [{ loadRendererBakeoffFixtures }, { runTextRendererBakeoff }] = await Promise.all([
        import('./rendererBakeoffFixtures.dev'), import('./runTextRendererBakeoff')
      ]);
      const run = runTextRendererBakeoff(
        await loadRendererBakeoffFixtures(),
        (rendererPhase) => {
          if (rendererAbortRef.current === abort) setState((current) => ({ ...current, rendererPhase }));
        },
        abort.signal
      );
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          run,
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => {
              abort.abort();
              reject(new Error('GPU text renderer bakeoff exceeded the 180 second diagnostic limit.'));
            }, 180_000);
          })
        ]);
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
      }
    })().then((rendererReport) => {
      if (rendererAbortRef.current !== abort) return;
      const summary = `Coverage ${rendererReport.decision.coverageAtlas}; hb-gpu ${rendererReport.decision.hbGpu}.`;
      setState((current) => ({
        ...current, rendererStatus: 'ready', rendererPhase: null, rendererReport, summary
      }));
      append('info', 'GPU text renderer bakeoff', summary, JSON.stringify(rendererReport, null, 2));
    }).catch((reason: unknown) => {
      if (rendererAbortRef.current !== abort) return;
      if (abort.signal.aborted && !(reason instanceof Error && /exceeded the 180 second/.test(reason.message))) {
        setState((current) => ({
          ...current, rendererStatus: 'idle', rendererPhase: null, summary: 'GPU renderer bakeoff canceled.'
        }));
        return;
      }
      const message = reason instanceof Error ? reason.message : 'GPU text renderer bakeoff failed.';
      setState((current) => ({
        ...current, rendererStatus: 'error', rendererPhase: null, summary: message
      }));
      append('error', 'GPU text renderer bakeoff', message);
    }).finally(() => {
      if (rendererAbortRef.current === abort) rendererAbortRef.current = null;
    });
  }, [append]);

  return { state, probe, runCorpus, runRendererBakeoff };
};
