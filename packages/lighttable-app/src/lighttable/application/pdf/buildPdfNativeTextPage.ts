import {
  type PdfExportTextRunPlan,
  type PdfNativeTextGlyph,
  type PdfNativeTextPage,
  type PdfNativeTextPaint,
  type PdfNativeTextRun,
  type PdfPaint,
  type PdfTextExportPlan,
  type PdfTextRenderingMode
} from '@lighttable/pdf-core';
import type {
  Matrix3,
  RealizedGlyphRun,
  RealizedTextLayout,
  TextRunPaint,
  TextRenderingMode
} from '@lighttable/text-core';
import {
  identityAffineMatrix,
  multiplyMatrices,
  scaleMatrix,
  translationMatrix,
  type AffineMatrix
} from '@lighttable/vector-core';
import type {
  ImageDocument,
  LayerId,
  LayerNode,
  TextLayer
} from '../../editor/document/documentTypes';
import { buildSceneTransformIndex, requireSceneTransform } from '../../editor/document/sceneTransformGraph';

const DEFAULT_PIXELS_PER_INCH = 300;
const MAXIMUM_NATIVE_TEXT_RUNS = 1_000_000;
const MAXIMUM_NATIVE_TEXT_GLYPHS = 10_000_000;

export interface PdfNativeTextPageDependencies {
  readonly document: ImageDocument;
  readonly plan: PdfTextExportPlan;
  readonly realizedLayout: (layerId: LayerId) => RealizedTextLayout | null;
  readonly pixelsPerInch?: number;
}

const fail = (message: string): never => {
  throw new Error(`PDF native text page ${message}`);
};

const matrix3ToAffine = (matrix: Matrix3 | Float32Array, offset = 0): AffineMatrix => {
  const a = matrix[offset]!;
  const c = matrix[offset + 1]!;
  const tx = matrix[offset + 2]!;
  const b = matrix[offset + 3]!;
  const d = matrix[offset + 4]!;
  const ty = matrix[offset + 5]!;
  const p = matrix[offset + 6]!;
  const q = matrix[offset + 7]!;
  const w = matrix[offset + 8]!;
  if (![a, b, c, d, tx, ty, p, q, w].every(Number.isFinite)
    || Math.abs(p) > 1e-6 || Math.abs(q) > 1e-6 || Math.abs(w - 1) > 1e-6) {
    return fail('contains a non-affine glyph or text matrix.');
  }
  return { a, b, c, d, tx, ty };
};

const pdfMatrix = (matrix: AffineMatrix) => Object.freeze([
  matrix.a, matrix.b, matrix.c, matrix.d, matrix.tx, matrix.ty
] as const);

const renderingMode = (mode: TextRenderingMode): PdfTextRenderingMode => ({
  fill: 0,
  stroke: 1,
  'fill-stroke': 2,
  invisible: 3,
  'fill-clip': 4,
  'stroke-clip': 5,
  'fill-stroke-clip': 6,
  clip: 7
})[mode] as PdfTextRenderingMode;

const paint = (source: TextRunPaint): PdfNativeTextPaint => {
  const solid = (value: TextRunPaint['fill'], label: string): PdfPaint | null => {
    if (!value) return null;
    if (value.kind !== 'solid' || value.color.colorSpace !== 'srgb') {
      return fail(`${label} is not directly representable as DeviceRGB.`);
    }
    return Object.freeze({
      kind: 'device-rgb' as const,
      r: value.color.r,
      g: value.color.g,
      b: value.color.b
    });
  };
  const fill = solid(source.fill, 'fill paint');
  const strokePaint = solid(source.stroke?.paint, 'stroke paint');
  return Object.freeze({
    fill,
    fillAlpha: source.fill?.kind === 'solid' ? source.fill.color.a : 1,
    stroke: source.stroke && strokePaint ? Object.freeze({
      paint: strokePaint,
      width: source.stroke.width,
      cap: source.stroke.cap,
      join: source.stroke.join,
      miterLimit: source.stroke.miterLimit,
      alpha: source.stroke.paint.kind === 'solid' ? source.stroke.paint.color.a : 1
    }) : null
  });
};

const textLayers = (nodes: readonly LayerNode[]): readonly TextLayer[] => nodes.flatMap(node => (
  node.type === 'group' ? textLayers(node.children) : node.type === 'text' ? [node] : []
));

const runPlan = (
  plans: ReadonlyMap<string, PdfExportTextRunPlan>,
  runId: string,
  glyphIds: readonly number[]
) => {
  const result = plans.get(runId) ?? fail(`is missing preflight run ${runId}.`);
  if (result.disposition !== 'text' || !result.encodingId) return null;
  if (result.encoding.length !== glyphIds.length
    || result.encoding.some((entry, index) => entry.glyphId !== glyphIds[index])) {
    return fail(`run ${runId} no longer matches its preflight encoding.`);
  }
  return result;
};

const glyph = (
  plan: PdfExportTextRunPlan,
  index: number,
  origin: readonly [number, number],
  advance: readonly [number, number],
  matrix: AffineMatrix
): PdfNativeTextGlyph => {
  const encoding = plan.encoding[index]!;
  return Object.freeze({
    code: encoding.code,
    glyphId: encoding.glyphId,
    unicode: encoding.unicode,
    origin: Object.freeze({ x: origin[0], y: origin[1] }),
    advance: Object.freeze({ x: advance[0], y: advance[1] }),
    textMatrix: pdfMatrix(matrix)
  });
};

const flowRun = (
  layer: TextLayer,
  run: RealizedGlyphRun,
  plan: PdfExportTextRunPlan,
  layerToPage: AffineMatrix
): PdfNativeTextRun => {
  const glyphs = [...run.glyphIds].map((_, index) => {
    const offset = index * 4;
    const x = run.geometry[offset]!;
    const y = run.geometry[offset + 1]!;
    const transform = run.transforms
      ? matrix3ToAffine(run.transforms, index * 9)
      : identityAffineMatrix();
    const textToPage = multiplyMatrices(
      layerToPage,
      multiplyMatrices(
        translationMatrix(x, y),
        multiplyMatrices(transform, scaleMatrix(1, -1))
      )
    );
    return glyph(plan, index, [x, y], [
      run.geometry[offset + 2]!, run.geometry[offset + 3]!
    ], textToPage);
  });
  return Object.freeze({
    runId: plan.runId,
    layerId: layer.id,
    fontInstanceId: plan.fontInstanceId,
    encodingId: plan.encodingId!,
    fontSize: run.fontSize,
    renderingMode: renderingMode(run.renderingMode),
    paint: paint(run.paint),
    encoding: Object.freeze([...plan.encoding]),
    actualText: Object.freeze([...plan.actualText]),
    glyphs: Object.freeze(glyphs)
  });
};

const positionedRun = (
  layer: TextLayer,
  run: Extract<TextLayer['text']['source'], { kind: 'positioned' }>['runs'][number],
  plan: PdfExportTextRunPlan,
  layerToPage: AffineMatrix
): PdfNativeTextRun => {
  const runToLayer = matrix3ToAffine(run.textMatrix);
  const glyphs = run.glyphs.map((source, index) => {
    const localTransform = source.localTransform
      ? matrix3ToAffine(source.localTransform)
      : identityAffineMatrix();
    const textToPage = multiplyMatrices(
      layerToPage,
      multiplyMatrices(
        runToLayer,
        multiplyMatrices(
          translationMatrix(source.x, source.y),
          multiplyMatrices(localTransform, scaleMatrix(1, -1))
        )
      )
    );
    return glyph(plan, index, [source.x, source.y], [source.advanceX, source.advanceY], textToPage);
  });
  return Object.freeze({
    runId: plan.runId,
    layerId: layer.id,
    fontInstanceId: plan.fontInstanceId,
    encodingId: plan.encodingId!,
    // Exact positioned sources carry scale in their preserved text matrix.
    fontSize: 1,
    renderingMode: renderingMode(run.renderingMode),
    paint: paint(run.paint),
    encoding: Object.freeze([...plan.encoding]),
    actualText: Object.freeze([...plan.actualText]),
    glyphs: Object.freeze(glyphs)
  });
};

/**
 * Snapshots exact glyph geometry into PDF page space without reshaping.
 * A stale preflight fails closed instead of silently exporting shifted text.
 */
export const buildPdfNativeTextPage = ({
  document,
  plan,
  realizedLayout,
  pixelsPerInch = DEFAULT_PIXELS_PER_INCH
}: PdfNativeTextPageDependencies): PdfNativeTextPage => {
  if (!Number.isFinite(pixelsPerInch) || pixelsPerInch <= 0 || pixelsPerInch > 2_400) {
    fail('pixelsPerInch must be between zero and 2400.');
  }
  const scale = 72 / pixelsPerInch;
  const widthPoints = document.width * scale;
  const heightPoints = document.height * scale;
  const documentToPage: AffineMatrix = {
    a: scale, b: 0, c: 0, d: -scale, tx: 0, ty: heightPoints
  };
  const scene = buildSceneTransformIndex(document);
  const layerPlans = new Map(plan.layers.map(layer => [layer.layerId, layer]));
  const plans = new Map(plan.layers.flatMap(layer => layer.runs).map(run => [run.runId, run]));
  const runs: PdfNativeTextRun[] = [];
  let glyphCount = 0;
  for (const layer of textLayers(document.layers)) {
    const layerPlan = layerPlans.get(layer.id);
    if (!layer.visible || !layerPlan || !['text', 'mixed'].includes(layerPlan.disposition)) continue;
    const layerToPage = multiplyMatrices(
      documentToPage,
      requireSceneTransform(scene, layer.id).localToDocument
    );
    if (layer.text.source.kind === 'flow') {
      const layout = realizedLayout(layer.id) ?? fail(`is missing realized layout for ${layer.id}.`);
      layout.glyphRuns.forEach((run, index) => {
        const id = `${layer.id}:flow:${index}`;
        const current = runPlan(plans, id, [...run.glyphIds]);
        if (current) {
          const output = flowRun(layer, run, current, layerToPage);
          runs.push(output);
          glyphCount += output.glyphs.length;
        }
      });
    } else {
      layer.text.source.runs.forEach((run, index) => {
        const id = `${layer.id}:positioned:${index}`;
        const current = runPlan(plans, id, run.glyphs.map(entry => entry.glyphId));
        if (current) {
          const output = positionedRun(layer, run, current, layerToPage);
          runs.push(output);
          glyphCount += output.glyphs.length;
        }
      });
    }
    if (runs.length > MAXIMUM_NATIVE_TEXT_RUNS) fail(`exceeds ${MAXIMUM_NATIVE_TEXT_RUNS} runs.`);
    if (glyphCount > MAXIMUM_NATIVE_TEXT_GLYPHS) fail(`exceeds ${MAXIMUM_NATIVE_TEXT_GLYPHS} glyphs.`);
  }
  return Object.freeze({
    widthPoints,
    heightPoints,
    pixelsPerInch,
    runs: Object.freeze(runs)
  });
};
