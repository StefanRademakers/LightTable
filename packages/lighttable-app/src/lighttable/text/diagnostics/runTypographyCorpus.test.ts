import { describe, expect, it, vi } from 'vitest';
import { TEXT_LAYOUT_SCHEMA_VERSION, type RealizedTextLayout } from '@lighttable/text-core';
import type { TextEngineClient } from '../wasm/TextEngineClient';
import { runTypographyCorpus } from './runTypographyCorpus';
import { TYPOGRAPHY_CORPUS, TYPOGRAPHY_CORPUS_FONTS } from './typographyCorpus';

const realized = (input: Parameters<TextEngineClient['realizeTextDetailed']>[0]) => {
  const source = input.layer.source;
  if (source.kind !== 'flow') throw new Error('Expected flow diagnostic fixture.');
  const direction = /[\u0590-\u08ff]/u.test(source.text) ? 'rtl' as const : 'ltr' as const;
  const layout: RealizedTextLayout = {
    schemaVersion: TEXT_LAYOUT_SCHEMA_VERSION,
    key: input.cacheKey,
    glyphRuns: [{
      font: {
        font: source.styleRuns[0].requestedFont.preferredAsset!,
        variableAxes: {}, syntheticBold: false, syntheticItalic: false
      },
      fontSize: source.styleRuns[0].fontSize,
      fontResolution: {
        kind: 'flow-exact', sourceRunIndex: 0, requested: source.styleRuns[0].requestedFont
      },
      paint: { fill: source.styleRuns[0].fill }, renderingMode: 'fill', direction,
      glyphIds: new Uint32Array([1]), clusters: new Uint32Array([0]),
      geometry: new Float32Array([0, 10, 8, 0])
    }],
    lines: [{ start: 0, end: source.text.length, baseline: 10, ascent: 8, descent: 2, bounds: { x: 0, y: 0, width: 8, height: 10 } }],
    caretStops: [], selectionGeometry: [],
    clusterMap: [{ textStart: 0, textEnd: source.text.length, glyphStart: 0, glyphEnd: 1 }],
    inkBounds: { x: 0, y: 2, width: 8, height: 8 },
    logicalBounds: { x: 0, y: 0, width: 8, height: 10 }, warnings: []
  };
  return {
    layout,
    metrics: { operationDurationMs: 0.25, wasmLinearMemoryBytes: 5_636_096 },
    roundTripDurationMs: 0.5,
    responseTransferBytes: 24
  };
};

describe('typography corpus diagnostics', () => {
  it('covers every required script with a stable unique identifier', () => {
    expect(TYPOGRAPHY_CORPUS.map((entry) => entry.id)).toEqual([
      'latin', 'arabic', 'hebrew', 'devanagari', 'thai', 'cjk',
      'combining', 'emoji', 'mixed-bidi'
    ]);
    expect(new Set(TYPOGRAPHY_CORPUS.map((entry) => entry.id)).size).toBe(TYPOGRAPHY_CORPUS.length);
  });

  it('uses the production register and realize APIs for cold and warm runs', async () => {
    const client = {
      probe: vi.fn(async () => ({ engineVersion: '0.1.0', loadDurationMs: 4 })),
      registerFontDetailed: vi.fn(async () => ({
        metrics: { operationDurationMs: 0.1, wasmLinearMemoryBytes: 5_636_096 },
        roundTripDurationMs: 0.2, responseTransferBytes: 0
      })),
      realizeTextDetailed: vi.fn(async (input) => realized(input)),
      releaseSession: vi.fn(async () => undefined)
    } as unknown as TextEngineClient;
    const bytes = new Map(TYPOGRAPHY_CORPUS_FONTS.map((entry) => [entry.id, new Uint8Array([1, 2, 3])]));
    const phases: string[] = [];
    const report = await runTypographyCorpus(client, bytes, (phase) => phases.push(phase));

    expect(client.registerFontDetailed).toHaveBeenCalledTimes(TYPOGRAPHY_CORPUS_FONTS.length);
    expect(client.realizeTextDetailed).toHaveBeenCalledTimes(TYPOGRAPHY_CORPUS.length * 4);
    expect(client.releaseSession).toHaveBeenCalledOnce();
    expect(report.cases.every((entry) => entry.passed)).toBe(true);
    expect(report.responseTransferBytes).toBe(TYPOGRAPHY_CORPUS.length * 24);
    expect(phases.at(-1)).toBe('Measuring warm layouts');
  });

  it('returns a partial report and skips a case after its first-pass failure', async () => {
    const failedLayerId = 'diagnostic.thai';
    const client = {
      probe: vi.fn(async () => ({ engineVersion: '0.1.0', loadDurationMs: 4 })),
      registerFontDetailed: vi.fn(async () => ({
        metrics: { operationDurationMs: 0.1, wasmLinearMemoryBytes: 65_536 },
        roundTripDurationMs: 0.2, responseTransferBytes: 0
      })),
      realizeTextDetailed: vi.fn(async (input: Parameters<TextEngineClient['realizeTextDetailed']>[0]) => {
        if (input.layerId === failedLayerId) throw new Error('Thai shaping rejected');
        return realized(input);
      }),
      releaseSession: vi.fn(async () => undefined)
    } as unknown as TextEngineClient;
    const bytes = new Map(TYPOGRAPHY_CORPUS_FONTS.map((entry) => [entry.id, new Uint8Array([1])]));

    const report = await runTypographyCorpus(client, bytes);

    expect(report.cases.find((entry) => entry.id === 'thai')).toMatchObject({
      passed: false,
      error: 'Thai shaping rejected'
    });
    expect(report.cases.filter((entry) => entry.passed)).toHaveLength(TYPOGRAPHY_CORPUS.length - 1);
    expect(client.realizeTextDetailed).toHaveBeenCalledTimes(TYPOGRAPHY_CORPUS.length + ((TYPOGRAPHY_CORPUS.length - 1) * 3));
    expect(client.releaseSession).toHaveBeenCalledOnce();
  });

  it('keeps the report when a case fails during a warm sample', async () => {
    let latinCalls = 0;
    const client = {
      probe: vi.fn(async () => ({ engineVersion: '0.1.0', loadDurationMs: 4 })),
      registerFontDetailed: vi.fn(async () => ({
        metrics: { operationDurationMs: 0.1, wasmLinearMemoryBytes: 65_536 },
        roundTripDurationMs: 0.2, responseTransferBytes: 0
      })),
      realizeTextDetailed: vi.fn(async (input: Parameters<TextEngineClient['realizeTextDetailed']>[0]) => {
        if (input.layerId === 'diagnostic.latin' && ++latinCalls === 2) throw new Error('Warm cache rejected');
        return realized(input);
      }),
      releaseSession: vi.fn(async () => undefined)
    } as unknown as TextEngineClient;
    const bytes = new Map(TYPOGRAPHY_CORPUS_FONTS.map((entry) => [entry.id, new Uint8Array([1])]));

    const report = await runTypographyCorpus(client, bytes);

    expect(report.cases.find((entry) => entry.id === 'latin')).toMatchObject({
      passed: false,
      error: 'Warm layout failed: Warm cache rejected'
    });
    expect(latinCalls).toBe(2);
    expect(report.warmCorpusP95Ms).toBeGreaterThanOrEqual(0);
  });
});
