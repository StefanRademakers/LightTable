import {
  compareR8Images, decideTextRendererBakeoff, packCoverageAtlas, parseHbGpuFixtureBundle,
  type RendererBakeoffDecision, type RendererBakeoffMeasurement
} from '@lighttable/text-rendering';
import { CoverageAtlasPrototype, HbGpuPrototype, validateTextBakeoffShaders } from '@lighttable/text-webgpu';
import { requestSharedWebGpuDevice } from '../../gpu/sharedWebGpuDevice';
import { readRgba8Texture } from '../../gpu/gpuReadback';
import { lightTableTextEngine, type TextEngineClient } from '../wasm/TextEngineClient';
import { realizeTypographyCorpusCase } from './runTypographyCorpus';
import { TYPOGRAPHY_CORPUS, TYPOGRAPHY_CORPUS_FONTS } from './typographyCorpus';

export interface TextRendererBakeoffReport {
  readonly schemaVersion: 1;
  readonly runAt: string;
  readonly adapter: string;
  readonly hardwareCoverage: Readonly<Record<'nvidia' | 'intel' | 'amd' | 'mac', 'tested' | 'unavailable'>>;
  readonly measurements: readonly RendererBakeoffMeasurement[];
  readonly decision: RendererBakeoffDecision;
}

interface BakeoffFixtures {
  readonly fonts: ReadonlyMap<string, Uint8Array>;
  readonly hbGpuBundles: ReadonlyMap<string, Uint8Array>;
}

const scenarios = [
  { id: 'small-12px', ppem: 12, matrix: [1, 0, 0, 1, 0, 0] as const },
  { id: 'normal-24px', ppem: 24, matrix: [1, 0, 0, 1, 0, 0] as const },
  { id: 'zoom-96px', ppem: 96, matrix: [1, 0, 0, 1, 0, 0] as const },
  { id: 'extreme-192px', ppem: 192, matrix: [1, 0, 0, 1, 0, 0] as const },
  { id: 'rotated-sheared-48px', ppem: 48, matrix: [0.94, 0.34, 0.22, 1, 0, 0] as const }
] as const;
const now = () => performance.now();
const median = (values: readonly number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const hash = async (bytes: ArrayLike<number>) => Array.from(
  new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)))
).map((value) => value.toString(16).padStart(2, '0')).join('');
const alpha = (pixels: ArrayLike<number>) => {
  const result = new Uint8Array(pixels.length / 4);
  for (let index = 0; index < result.length; index += 1) result[index] = pixels[index * 4 + 3];
  return result;
};
let generation = 0;

export const runTextRendererBakeoff = async (
  fixtures: BakeoffFixtures,
  onProgress: (phase: string) => void = () => undefined,
  signal?: AbortSignal,
  client: TextEngineClient = lightTableTextEngine
): Promise<TextRendererBakeoffReport> => {
  const documentSessionId = `renderer-bakeoff-${Date.now()}`;
  const sessionGeneration = ++generation;
  const inspections = new Map<string, Awaited<ReturnType<TextEngineClient['inspectFont']>>>();
  let revision = 0;
  try {
    onProgress('Registering the multilingual renderer corpus');
    for (const font of TYPOGRAPHY_CORPUS_FONTS) {
      const bytes = fixtures.fonts.get(font.id);
      if (!bytes) throw new Error(`Missing renderer font ${font.id}.`);
      inspections.set(font.id, await client.inspectFont(bytes, 0));
      await client.registerFontDetailed({
        kind: 'register-font', documentSessionId, sessionGeneration, font: font.asset,
        fontSnapshotRevision: ++revision, bytes: Uint8Array.from(bytes),
        byteSource: 'transferred', transferOwnership: 'dedicated'
      }, signal);
    }
    const device = await requestSharedWebGpuDevice();
    const validations = new Map((await validateTextBakeoffShaders(device)).map((entry) => [entry.candidate, entry]));
    const measurements: RendererBakeoffMeasurement[] = [];
    const cases = TYPOGRAPHY_CORPUS.filter((entry) => entry.id !== 'mixed-bidi');
    for (const corpusCase of cases) {
      const fontId = corpusCase.runs[0].fontId;
      const font = TYPOGRAPHY_CORPUS_FONTS.find((entry) => entry.id === fontId)!;
      const inspection = inspections.get(fontId)!;
      const bundleBytes = fixtures.hbGpuBundles.get(fontId);
      if (!bundleBytes) throw new Error(`Missing renderer bundle ${fontId}.`);
      const bundle = parseHbGpuFixtureBundle(bundleBytes);
      onProgress(`Realizing ${corpusCase.label}`);
      const layout = (await realizeTypographyCorpusCase(
        client, documentSessionId, sessionGeneration, revision, corpusCase, signal
      )).layout;
      const positioned = layout.glyphRuns.flatMap((run) => Array.from(run.glyphIds, (glyphId, index) => ({
        glyphId, x: run.geometry[index * 4], y: run.geometry[index * 4 + 1]
      })));
      for (const scenario of scenarios) {
        if (signal?.aborted) throw new DOMException('Renderer bakeoff aborted.', 'AbortError');
        const scenarioId = `${corpusCase.id}:${scenario.id}`;
        const scale = scenario.ppem / 24;
        const plan = positioned.map((entry) => ({ ...entry, x: 32 + entry.x * scale, y: 112 + entry.y * scale }));
        const uniqueGlyphIds = [...new Set(plan.map((entry) => entry.glyphId))];
        onProgress(`Rasterizing ${scenarioId}`);
        const coverageStarted = now();
        const masks = await Promise.all(uniqueGlyphIds.map(async (glyphId) => {
          const result = await client.rasterizeGlyph({
            kind: 'rasterize-glyph', documentSessionId, sessionGeneration,
            assetId: font.asset.assetId, faceIndex: 0, glyphId,
            ppem: scenario.ppem, fontSnapshotRevision: revision
          }, signal);
          return { key: String(glyphId), width: result.raster.width, height: result.raster.height,
            bearingX: result.raster.bearingX, bearingY: result.raster.bearingY, pixels: result.raster.pixels };
        }));
        const atlas = packCoverageAtlas(masks, 1024);
        const coverage = await CoverageAtlasPrototype.create(device, atlas);
        let coverageSurface: ReturnType<CoverageAtlasPrototype['createSurface']> | null = null;
        try {
          const coldPreparationMs = now() - coverageStarted;
          coverageSurface = coverage.createSurface(768, 320);
          const [a, b, c, d, e, f] = scenario.matrix;
          const coverageDraws = plan.map((entry) => ({
            key: String(entry.glyphId), x: a * entry.x + c * entry.y + e, y: b * entry.x + d * entry.y + f,
            color: [1, 1, 1, 1] as const, transform: [a, b, c, d] as const
          }));
          const coverageMetrics = await coverage.render(coverageSurface, coverageDraws);
          const coveragePixels = await readRgba8Texture(device, coverageSurface.texture, 768, 320);
          const warm: number[] = [];
          for (let sample = 0; sample < 3; sample += 1) {
            const started = now(); await coverage.render(coverageSurface, coverageDraws); warm.push(now() - started);
          }
          measurements.push({ candidate: 'coverage-atlas', scenarioId, coldPreparationMs,
            warmFrameMs: median(warm), uploadBytes: coverageMetrics.uploadBytes,
            estimatedVramBytes: coverageMetrics.estimatedVramBytes, drawBatches: coverageMetrics.drawBatches,
            meanAbsoluteError: 0, maximumAbsoluteError: 0,
            shaderValidated: validations.get('coverage-atlas')?.validated ?? false,
            captureHash: await hash(coveragePixels), adapterName: 'shared WebGPU adapter' });

          const hbStarted = now();
          const hbGpu = await HbGpuPrototype.create(device, bundle);
          let hbSurface: ReturnType<CoverageAtlasPrototype['createSurface']> | null = null;
          try {
            const coldHbMs = now() - hbStarted;
            hbSurface = coverage.createSurface(768, 320);
            const encoded = new Set(bundle.glyphs.filter((glyph) => glyph.storageTexels > 0).map((glyph) => glyph.glyphId));
            const hbDraws = plan.filter((entry) => encoded.has(entry.glyphId)).map((entry) => ({
              glyphId: entry.glyphId, x: entry.x, y: entry.y,
              fontSize: scenario.ppem, unitsPerEm: inspection.unitsPerEm
            }));
            const hbMetrics = await hbGpu.render(hbSurface, hbDraws, [1, 1, 1, 1], scenario.matrix);
            const hbPixels = await readRgba8Texture(device, hbSurface.texture, 768, 320);
            const hbWarm: number[] = [];
            for (let sample = 0; sample < 3; sample += 1) {
              const started = now(); await hbGpu.render(hbSurface, hbDraws, [1, 1, 1, 1], scenario.matrix);
              hbWarm.push(now() - started);
            }
            measurements.push({ candidate: 'hb-gpu', scenarioId, coldPreparationMs: coldHbMs,
              warmFrameMs: median(hbWarm), uploadBytes: hbMetrics.uploadBytes,
              estimatedVramBytes: hbMetrics.estimatedVramBytes, drawBatches: hbMetrics.drawBatches,
              ...compareR8Images(alpha(coveragePixels), alpha(hbPixels)),
              shaderValidated: validations.get('hb-gpu')?.validated ?? false,
              captureHash: await hash(hbPixels), adapterName: 'shared WebGPU adapter' });
          } finally { hbSurface?.dispose(); hbGpu.dispose(); }
        } finally { coverageSurface?.dispose(); coverage.dispose(); }
      }
    }
    return { schemaVersion: 1, runAt: new Date().toISOString(),
      adapter: 'shared WebGPU adapter (identity unavailable)',
      hardwareCoverage: { nvidia: 'unavailable', intel: 'unavailable', amd: 'unavailable', mac: 'unavailable' },
      measurements, decision: decideTextRendererBakeoff(measurements) };
  } finally {
    await client.releaseSession(documentSessionId, sessionGeneration).catch(() => undefined);
  }
};
