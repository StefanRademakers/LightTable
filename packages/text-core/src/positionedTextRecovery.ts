import type {
  FlowTextSource,
  Matrix3,
  ParagraphStyleRun,
  PositionedTextRun,
  PositionedTextSource,
  TextStyleRun
} from './types';

export type PositionedTextRecoveryEvidenceCode =
  | 'semantic-text-complete'
  | 'semantic-text-partial'
  | 'logical-order-uncertain'
  | 'source-outline-only'
  | 'exact-positioning-will-be-reshaped'
  | 'font-asset-preserved'
  | 'font-size-estimated'
  | 'uniform-transform-preserved'
  | 'geometry-approximated'
  | 'unsupported-text-clipping'
  | 'unsupported-perspective'
  | 'unsupported-singular-transform'
  | 'unsupported-skew'
  | 'unsupported-per-glyph-transform'
  | 'unsupported-baseline-direction'
  | 'inconsistent-run-rotation';

export interface PositionedTextRecoveryEvidence {
  readonly code: PositionedTextRecoveryEvidenceCode;
  readonly severity: 'support' | 'warning' | 'blocker';
  readonly message: string;
  readonly runIndex?: number;
  readonly glyphIndex?: number;
}

export interface PositionedTextRecoveryPreview {
  readonly source: FlowTextSource;
  /**
   * Rotation-only transform to compose after the existing common layer
   * transform. Translation remains in the recovered point-text origin.
   */
  readonly layerTransformDelta: Matrix3;
}

export interface PositionedTextRecoveryAnalysis {
  readonly status: 'blocked' | 'available' | 'recommended';
  readonly confidence: number;
  readonly evidence: readonly PositionedTextRecoveryEvidence[];
  readonly preview?: PositionedTextRecoveryPreview;
}

const EPSILON = 1e-6;
const RECOMMENDED_CONFIDENCE = 0.85;
const AVAILABLE_CONFIDENCE = 0.65;

const identityMatrix = (): Matrix3 => [
  1, 0, 0,
  0, 1, 0,
  0, 0, 1
];

const clamp01 = (value: number) => {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped > 1 - 1e-12 ? 1 : clamped;
};
const radiansApart = (left: number, right: number) => {
  const turn = Math.PI * 2;
  const delta = Math.abs(((left - right + Math.PI) % turn + turn) % turn - Math.PI);
  return delta;
};

interface RunGeometry {
  readonly rotation: number;
  readonly orientation: 1 | -1;
  readonly fontSize: number;
  readonly horizontalScale: number;
  readonly origin: { readonly x: number; readonly y: number };
  readonly geometryScore: number;
  readonly estimatedFontSize: boolean;
}

const analyzeRunGeometry = (
  run: PositionedTextRun,
  runIndex: number,
  evidence: PositionedTextRecoveryEvidence[]
): RunGeometry | null => {
  const [a, c, tx, b, d, ty, p, q, w] = run.textMatrix;
  if (Math.abs(p) > EPSILON || Math.abs(q) > EPSILON || Math.abs(w - 1) > EPSILON) {
    evidence.push({
      code: 'unsupported-perspective', severity: 'blocker', runIndex,
      message: 'Perspective text matrices cannot be represented by editable flow text.'
    });
    return null;
  }
  const determinant = a * d - b * c;
  if (Math.abs(determinant) <= EPSILON) {
    evidence.push({
      code: 'unsupported-singular-transform', severity: 'blocker', runIndex,
      message: 'A singular text matrix cannot be recovered safely.'
    });
    return null;
  }
  const xScale = Math.hypot(a, b);
  const yScale = Math.hypot(c, d);
  if (xScale <= EPSILON || yScale <= EPSILON) {
    evidence.push({
      code: 'unsupported-singular-transform', severity: 'blocker', runIndex,
      message: 'Singular text scale cannot be recovered safely.'
    });
    return null;
  }
  const rotation = Math.atan2(b, a);
  const orientation = determinant < 0 ? -1 : 1;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const localA = cos * a + sin * b;
  const localC = cos * c + sin * d;
  const localD = orientation * (-sin * c + cos * d);
  const skewRatio = Math.abs(localC) / Math.max(Math.abs(localA), Math.abs(localD), EPSILON);
  if (skewRatio > 0.02) {
    evidence.push({
      code: 'unsupported-skew', severity: 'blocker', runIndex,
      message: 'Skewed text requires a richer flow transform model.'
    });
    return null;
  }
  const first = run.glyphs[0];
  const sourceX = first?.x ?? 0;
  const sourceY = first?.y ?? 0;
  const layerX = a * sourceX + c * sourceY + tx;
  const layerY = b * sourceX + d * sourceY + ty;
  const origin = {
    x: cos * layerX + sin * layerY,
    y: orientation * (-sin * layerX + cos * layerY)
  };
  const matrixFontSize = Math.abs(localD);
  const sampleStride = Math.max(1, Math.ceil(run.glyphs.length / 257));
  const advances = run.glyphs
    .filter((_glyph, index) => index % sampleStride === 0)
    .map(glyph => Math.hypot(glyph.advanceX, glyph.advanceY))
    .filter(value => value > EPSILON)
    .sort((left, right) => left - right);
  const medianAdvance = advances.length > 0 ? advances[Math.floor(advances.length / 2)]! : 0;
  const estimatedFontSize = matrixFontSize < 2 && medianAdvance >= 2;
  const fontSize = estimatedFontSize ? medianAdvance / 0.6 : matrixFontSize;
  if (estimatedFontSize) {
    evidence.push({
      code: 'font-size-estimated', severity: 'warning', runIndex,
      message: 'The source omitted an explicit size; the preview estimates it from glyph advances.'
    });
  }
  return {
    rotation,
    orientation,
    fontSize: Math.max(0.01, fontSize),
    horizontalScale: Math.max(1, Math.min(1000, Math.abs(localA) / Math.max(matrixFontSize, EPSILON) * 100)),
    origin,
    geometryScore: estimatedFontSize ? 0.65 : skewRatio <= 0.002 ? 1 : 0.85,
    estimatedFontSize
  };
};

const hasMeaningfulLocalTransform = (matrix: Matrix3 | undefined) => matrix !== undefined
  && matrix.some((value, index) => Math.abs(value - identityMatrix()[index]!) > EPSILON);

interface SemanticRun {
  readonly runIndex: number;
  readonly text: string;
}

const semanticRuns = (
  source: PositionedTextSource,
  evidence: PositionedTextRecoveryEvidence[]
): { readonly text: string; readonly spans: readonly { runIndex: number; start: number; end: number }[]; readonly coverage: number } | null => {
  let glyphCount = 0;
  let coveredGlyphCount = 0;
  const runs: SemanticRun[] = source.runs.map((run, runIndex) => {
    let text = '';
    for (const glyph of run.glyphs) {
      glyphCount += 1;
      if (glyph.unicode !== undefined && glyph.unicode.length > 0) {
        coveredGlyphCount += 1;
        text += glyph.unicode;
      }
    }
    return { runIndex, text };
  });
  const coverage = glyphCount === 0 ? 0 : coveredGlyphCount / glyphCount;
  const extracted = source.extractedText;
  if (extracted !== undefined && extracted.length > 0) {
    let cursor = 0;
    const spans: Array<{ runIndex: number; start: number; end: number }> = [];
    for (const run of runs) {
      if (run.text.length === 0) continue;
      const found = extracted.indexOf(run.text, cursor);
      if (found < cursor || /\S/u.test(extracted.slice(cursor, found))) return null;
      spans.push({ runIndex: run.runIndex, start: found, end: found + run.text.length });
      cursor = found + run.text.length;
    }
    if (spans.length === 0 || /\S/u.test(extracted.slice(cursor))) return null;
    evidence.push({
      code: coverage === 1 ? 'semantic-text-complete' : 'semantic-text-partial',
      severity: coverage === 1 ? 'support' : 'warning',
      message: coverage === 1
        ? 'Unicode and extracted logical text agree.'
        : 'Logical text is available, but some glyphs lack direct Unicode mapping.'
    });
    return { text: extracted, spans, coverage: Math.max(coverage, 0.8) };
  }
  if (coverage < 1 || runs.every(run => run.text.length === 0)) return null;
  const text = runs.map(run => run.text).join('');
  let cursor = 0;
  const spans = runs.map(run => {
    const start = cursor;
    cursor += run.text.length;
    return { runIndex: run.runIndex, start, end: cursor };
  }).filter(span => span.end > span.start);
  evidence.push({
    code: 'semantic-text-complete', severity: 'support',
    message: 'Every positioned glyph has an explicit Unicode mapping.'
  });
  return { text, spans, coverage };
};

const styleFor = (
  run: PositionedTextRun,
  geometry: RunGeometry,
  start: number,
  end: number
): TextStyleRun => ({
  start,
  end,
  requestedFont: {
    families: [run.font.font.postScriptName ?? 'Imported font'],
    ...(run.font.font.postScriptName === undefined ? {} : { postScriptName: run.font.font.postScriptName }),
    preferredAsset: run.font.font
  },
  fontSize: geometry.fontSize,
  fontWeight: run.font.syntheticBold ? 700 : 400,
  fontStyle: run.font.syntheticItalic ? 'italic' : 'normal',
  fontStretch: 100,
  ...(('fill' in run.paint && run.paint.fill !== undefined) ? { fill: run.paint.fill } : {}),
  ...(('stroke' in run.paint && run.paint.stroke !== undefined) ? { stroke: run.paint.stroke } : {}),
  tracking: 0,
  kerning: 'auto',
  baselineShift: 0,
  horizontalScale: geometry.horizontalScale,
  verticalScale: 100,
  openTypeFeatures: {},
  variableAxes: run.font.variableAxes,
  syntheticBold: run.font.syntheticBold,
  syntheticItalic: run.font.syntheticItalic
});

const paragraphRun = (end: number): ParagraphStyleRun => ({
  start: 0,
  end,
  alignment: 'start',
  direction: 'auto',
  lineHeight: { kind: 'normal' },
  firstLineIndent: 0,
  startIndent: 0,
  endIndent: 0,
  spaceBefore: 0,
  spaceAfter: 0,
  hyphenation: 'off'
});

/**
 * Produces a deterministic, non-mutating recovery preview. The exact source is
 * never discarded here; callers must expose an explicit undoable command.
 */
export const analyzePositionedTextRecovery = (
  source: PositionedTextSource
): PositionedTextRecoveryAnalysis => {
  const evidence: PositionedTextRecoveryEvidence[] = [];
  if (source.editability === 'outline-only') {
    evidence.push({
      code: 'source-outline-only', severity: 'blocker',
      message: 'The source is classified as outlines only and has no safe flow-text recovery path.'
    });
  } else if (source.editability === 'exact-positioned') {
    evidence.push({
      code: 'exact-positioning-will-be-reshaped', severity: 'warning',
      message: 'Recovery will reshape text and may differ from the exact imported glyph placement.'
    });
  }

  source.runs.forEach((run, runIndex) => {
    if (run.renderingMode.includes('clip') || run.renderingMode === 'clip') {
      evidence.push({
        code: 'unsupported-text-clipping', severity: 'blocker', runIndex,
        message: 'Text clipping cannot be represented by editable flow text.'
      });
    }
    const transformedGlyphIndex = run.glyphs.findIndex(glyph => hasMeaningfulLocalTransform(glyph.localTransform));
    if (transformedGlyphIndex >= 0) {
      evidence.push({
        code: 'unsupported-per-glyph-transform', severity: 'blocker', runIndex,
        glyphIndex: transformedGlyphIndex,
        message: 'A per-glyph transform would be lost during reshaping.'
      });
    }
    const diagonalAdvanceIndex = run.glyphs.findIndex(glyph => (
      Math.abs(glyph.advanceY) > Math.max(0.01, Math.abs(glyph.advanceX) * 0.05)
    ));
    if (diagonalAdvanceIndex >= 0) {
      evidence.push({
        code: 'unsupported-baseline-direction', severity: 'blocker', runIndex,
        glyphIndex: diagonalAdvanceIndex,
        message: 'Vertical or diagonal glyph advances are not recoverable as horizontal flow text yet.'
      });
    }
  });

  const semantics = semanticRuns(source, evidence);
  if (!semantics) {
    evidence.push({
      code: 'semantic-text-partial', severity: 'blocker',
      message: 'The positioned glyphs do not provide a trustworthy complete logical string.'
    });
  }
  const geometries = source.runs.map((run, index) => analyzeRunGeometry(run, index, evidence));
  const firstGeometry = geometries.find((entry): entry is RunGeometry => entry !== null);
  if (firstGeometry) {
    geometries.forEach((geometry, runIndex) => {
      if (geometry && (
        geometry.orientation !== firstGeometry.orientation
        || radiansApart(geometry.rotation, firstGeometry.rotation) > 0.005
      )) {
        evidence.push({
          code: 'inconsistent-run-rotation', severity: 'blocker', runIndex,
          message: 'Runs use different rotations and cannot share one flow-layer transform.'
        });
      }
    });
  }

  const logicalScore = clamp01(source.logicalOrderConfidence ?? (source.extractedText ? 0.75 : 0.65));
  if (logicalScore < 0.8) {
    evidence.push({
      code: 'logical-order-uncertain', severity: logicalScore < 0.5 ? 'blocker' : 'warning',
      message: `Logical reading order confidence is ${Math.round(logicalScore * 100)}%.`
    });
  }
  const geometryScore = geometries.length === 0
    ? 0
    : geometries.reduce((sum, geometry) => sum + (geometry?.geometryScore ?? 0), 0) / geometries.length;
  const semanticScore = semantics?.coverage ?? 0;
  const fontScore = source.runs.length > 0 && source.runs.every(run => run.font.font.assetId.length > 0) ? 1 : 0;
  if (fontScore === 1) {
    evidence.push({
      code: 'font-asset-preserved', severity: 'support',
      message: 'Every recovered style run keeps its exact document font asset preference.'
    });
  }
  const confidence = clamp01(
    semanticScore * 0.4
    + logicalScore * 0.3
    + geometryScore * 0.2
    + fontScore * 0.1
  );
  const blocked = evidence.some(entry => entry.severity === 'blocker')
    || !semantics || !firstGeometry || source.runs.length === 0;
  if (blocked || confidence < AVAILABLE_CONFIDENCE) {
    return { status: 'blocked', confidence, evidence };
  }

  const styleRuns = semantics.spans.map((span, index) => styleFor(
    source.runs[span.runIndex]!,
    geometries[span.runIndex]!,
    index === 0 ? 0 : span.start,
    semantics.spans[index + 1]?.start ?? semantics.text.length
  ));
  const rotation = firstGeometry.rotation;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  if (Math.abs(rotation) > 0.005 || firstGeometry.orientation < 0) {
    evidence.push({
      code: 'uniform-transform-preserved', severity: 'support',
      message: 'The common text rotation or reflection will be composed into the layer transform.'
    });
  }
  if (source.runs.length > 1 || firstGeometry.estimatedFontSize) {
    evidence.push({
      code: 'geometry-approximated', severity: 'warning',
      message: 'Run spacing is previewed as semantic flow and may reflow after editing.'
    });
  }
  const flow: FlowTextSource = {
    kind: 'flow',
    text: semantics.text,
    styleRuns,
    paragraphRuns: [paragraphRun(semantics.text.length)],
    layout: {
      mode: 'point',
      origin: firstGeometry.origin,
      writingMode: 'horizontal-tb'
    }
  };
  const hasEstimatedGeometry = geometries.some(geometry => geometry?.estimatedFontSize);
  return {
    status: confidence >= RECOMMENDED_CONFIDENCE
      && source.editability === 'recoverable'
      && !hasEstimatedGeometry
      ? 'recommended'
      : 'available',
    confidence,
    evidence,
    preview: {
      source: flow,
      layerTransformDelta: [
        cos, -firstGeometry.orientation * sin, 0,
        sin, firstGeometry.orientation * cos, 0,
        0, 0, 1
      ]
    }
  };
};
