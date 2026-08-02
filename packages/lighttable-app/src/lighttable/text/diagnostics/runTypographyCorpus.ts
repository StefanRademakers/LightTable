import {
  IDENTITY_MATRIX_3,
  createDefaultFlowTextSource,
  createDefaultTextLayerData,
  createTextLayoutCacheKey,
  type RealizedTextLayout,
  type TextStyleRun
} from '@lighttable/text-core';
import type { TextEngineClient, TextRealizationReport } from '../wasm/TextEngineClient';
import { TYPOGRAPHY_CORPUS, TYPOGRAPHY_CORPUS_FONTS, type TypographyScript } from './typographyCorpus';

export interface TypographyCorpusCaseResult {
  readonly id: TypographyScript;
  readonly passed: boolean;
  readonly glyphCount: number;
  readonly lineCount: number;
  readonly roundTripMs: number;
  readonly workerMs: number;
  readonly transferBytes: number;
  readonly structuralHash: string;
  readonly error?: string;
}

export interface TypographyCorpusReport {
  readonly engineVersion: string;
  readonly wasmInitializationMs: number;
  readonly coldRoundTripMs: number;
  readonly fontRegistrationMs: number;
  readonly firstCorpusLayoutMs: number;
  readonly warmCorpusMedianMs: number;
  readonly warmCorpusP95Ms: number;
  readonly responseTransferBytes: number;
  readonly wasmLinearMemoryBytes: number;
  readonly cases: readonly TypographyCorpusCaseResult[];
}

export type TypographyCorpusProgress = (phase: string) => void;
let diagnosticGeneration = 0;

const hashLayout = async (layout: RealizedTextLayout): Promise<string> => {
  const stable = layout.glyphRuns.flatMap((run) => [
    run.direction,
    ...run.glyphIds,
    ...run.clusters,
    ...Array.from(run.geometry, (value) => Math.round(value * 1_000))
  ]).join('|');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stable));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
};

const percentile = (values: readonly number[], percentileValue: number) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * percentileValue))] ?? 0;
};

const assertLayout = (layout: RealizedTextLayout, direction?: 'ltr' | 'rtl') => {
  const glyphCount = layout.glyphRuns.reduce((sum, run) => sum + run.glyphIds.length, 0);
  if (glyphCount === 0) throw new Error('Layout emitted no glyphs.');
  if (layout.glyphRuns.some((run) => run.fontResolution.kind !== 'flow-exact')) {
    throw new Error('Layout did not preserve exact font provenance.');
  }
  if (layout.warnings.some((warning) => warning.code === 'missing-glyph')) {
    throw new Error('Layout emitted a missing glyph warning.');
  }
  if (direction && !layout.glyphRuns.some((run) => run.direction === direction)) {
    throw new Error(`Layout did not emit an expected ${direction} run.`);
  }
  if (!layout.clusterMap.every((entry, index, entries) => index === 0
    || entries[index - 1].textStart <= entry.textStart)) {
    throw new Error('Cluster map is not in monotone logical order.');
  }
  return glyphCount;
};

const realizeCase = async (
  client: TextEngineClient,
  documentSessionId: string,
  sessionGeneration: number,
  fontSnapshotRevision: number,
  corpusCase: (typeof TYPOGRAPHY_CORPUS)[number],
  signal?: AbortSignal
): Promise<TextRealizationReport> => {
  const text = corpusCase.runs.map((run) => run.text).join('');
  const defaults = createDefaultFlowTextSource(text);
  let offset = 0;
  const styleRuns: TextStyleRun[] = corpusCase.runs.map((run) => {
    const font = TYPOGRAPHY_CORPUS_FONTS.find((entry) => entry.id === run.fontId)!;
    const start = offset;
    offset += run.text.length;
    return {
      ...defaults.styleRuns[0], start, end: offset,
      requestedFont: { families: [font.family], postScriptName: font.asset.postScriptName, preferredAsset: font.asset }
    };
  });
  const layer = { ...createDefaultTextLayerData(), source: { ...defaults, styleRuns } };
  const options = { quality: 'final' as const, effectiveScale: 1, maxGlyphCount: 10_000 };
  const identity = {
    documentSessionId, sessionGeneration, layerId: `diagnostic.${corpusCase.id}`,
    revisions: layer.revisions, fontSnapshotRevision, pathDependencyRevision: 0, options
  };
  return client.realizeTextDetailed({
    kind: 'realize-text', documentSessionId, sessionGeneration,
    layerId: identity.layerId, layer, localToDocument: IDENTITY_MATRIX_3,
    fontSnapshotRevision, pathDependencyRevision: 0,
    cacheKey: createTextLayoutCacheKey(identity), options
  }, signal);
};

export const runTypographyCorpus = async (
  client: TextEngineClient,
  fixtureBytes: ReadonlyMap<string, Uint8Array>,
  onProgress: TypographyCorpusProgress = () => undefined,
  signal?: AbortSignal
): Promise<TypographyCorpusReport> => {
  const documentSessionId = `typography-diagnostic-${Date.now()}`;
  const sessionGeneration = ++diagnosticGeneration;
  const coldStartedAt = performance.now();
  onProgress('Loading text WASM');
  const capability = await client.probe();
  const coldRoundTripMs = performance.now() - coldStartedAt;
  let revision = 0;
  let fontRegistrationMs = 0;
  let wasmLinearMemoryBytes = 0;
  try {
    for (const [index, corpusFont] of TYPOGRAPHY_CORPUS_FONTS.entries()) {
      onProgress(`Registering font ${index + 1}/${TYPOGRAPHY_CORPUS_FONTS.length}`);
      const bytes = fixtureBytes.get(corpusFont.id);
      if (!bytes) throw new Error(`Missing ${corpusFont.fileName} diagnostic fixture.`);
      const report = await client.registerFontDetailed({
        kind: 'register-font', documentSessionId, sessionGeneration,
        font: corpusFont.asset, fontSnapshotRevision: ++revision,
        bytes: Uint8Array.from(bytes), byteSource: 'transferred', transferOwnership: 'dedicated'
      }, signal);
      fontRegistrationMs += report.roundTripDurationMs;
      wasmLinearMemoryBytes = Math.max(wasmLinearMemoryBytes, report.metrics.wasmLinearMemoryBytes);
    }
    const firstStartedAt = performance.now();
    const cases: TypographyCorpusCaseResult[] = [];
    for (const [index, corpusCase] of TYPOGRAPHY_CORPUS.entries()) {
      onProgress(`Layout ${index + 1}/${TYPOGRAPHY_CORPUS.length}: ${corpusCase.label}`);
      try {
        const result = await realizeCase(client, documentSessionId, sessionGeneration, revision, corpusCase, signal);
        const glyphCount = assertLayout(result.layout, corpusCase.expectedDirection);
        wasmLinearMemoryBytes = Math.max(wasmLinearMemoryBytes, result.metrics.wasmLinearMemoryBytes);
        cases.push({
          id: corpusCase.id, passed: true, glyphCount, lineCount: result.layout.lines.length,
          roundTripMs: result.roundTripDurationMs, workerMs: result.metrics.operationDurationMs,
          transferBytes: result.responseTransferBytes, structuralHash: await hashLayout(result.layout)
        });
      } catch (reason) {
        cases.push({
          id: corpusCase.id, passed: false, glyphCount: 0, lineCount: 0,
          roundTripMs: 0, workerMs: 0, transferBytes: 0, structuralHash: '',
          error: reason instanceof Error ? reason.message : 'Unknown corpus failure.'
        });
      }
    }
    const firstCorpusLayoutMs = performance.now() - firstStartedAt;
    onProgress('Measuring warm layouts');
    const warmDurations: number[] = [];
    for (let sample = 0; sample < 3; sample += 1) {
      const startedAt = performance.now();
      for (const corpusCase of TYPOGRAPHY_CORPUS) {
        const resultIndex = cases.findIndex((entry) => entry.id === corpusCase.id);
        if (!cases[resultIndex]?.passed) continue;
        try {
          const result = await realizeCase(client, documentSessionId, sessionGeneration, revision, corpusCase, signal);
          assertLayout(result.layout, corpusCase.expectedDirection);
          wasmLinearMemoryBytes = Math.max(wasmLinearMemoryBytes, result.metrics.wasmLinearMemoryBytes);
        } catch (reason) {
          if (signal?.aborted) throw reason;
          cases[resultIndex] = {
            ...cases[resultIndex],
            passed: false,
            error: `Warm layout failed: ${reason instanceof Error ? reason.message : 'Unknown corpus failure.'}`
          };
        }
      }
      warmDurations.push(performance.now() - startedAt);
    }
    return {
      engineVersion: capability.engineVersion,
      wasmInitializationMs: capability.loadDurationMs,
      coldRoundTripMs,
      fontRegistrationMs,
      firstCorpusLayoutMs,
      warmCorpusMedianMs: percentile(warmDurations, 0.5),
      warmCorpusP95Ms: percentile(warmDurations, 0.95),
      responseTransferBytes: cases.reduce((sum, entry) => sum + entry.transferBytes, 0),
      wasmLinearMemoryBytes,
      cases
    };
  } finally {
    await client.releaseSession(documentSessionId, sessionGeneration).catch(() => undefined);
  }
};
