import type {
  RealizedGlyphRun,
  RealizedTextLayout,
  RgbaColor,
  TextPaint,
  TextStroke,
  TextWorkerGlyphOutlineResult
} from '@lighttable/text-core';
import {
  GLYPH_OUTLINE_EXTRACTOR_VERSION,
  serializeGlyphOutlineKey
} from '@lighttable/text-rendering';
import {
  multiplyMatrices,
  scaleMatrix,
  translationMatrix,
  type AffineMatrix,
  type VectorPath,
  type VectorStyle
} from '@lighttable/vector-core';
import { realizeVectorPath, type RealizedVectorGeometry } from '@lighttable/vector-rendering';
import type {
  TextGlyphOutlineRequest,
  TextGlyphOutlineResolution
} from './TextGlyphOutlineRepository';
import { glyphOutlineToVectorPath } from './glyphOutlineToVectorPath';

const DEFAULT_SOURCE_TOLERANCE = 0.25;

export interface TextOutlineVectorDraw {
  readonly path: VectorPath;
  readonly geometry: RealizedVectorGeometry;
  readonly runIndex: number;
  readonly glyphIndex: number;
}

export interface PreparedTextOutlineVectorDraws {
  readonly draws: readonly TextOutlineVectorDraw[];
  readonly uniqueOutlineCount: number;
}

export interface TextOutlinePreparationIdentity {
  readonly documentSessionId: string;
  readonly sessionGeneration: number;
  readonly fontSnapshotRevision: number;
  /** Authored/document output scale; never viewport zoom. */
  readonly sourceScale: number;
}

export interface TextOutlineRepositoryPort {
  resolve(request: TextGlyphOutlineRequest, signal?: AbortSignal): Promise<TextGlyphOutlineResolution>;
}

const srgbToLinear = (value: number) => value <= 0.04045
  ? value / 12.92
  : ((value + 0.055) / 1.055) ** 2.4;

const colorToLinearSrgb = (color: RgbaColor): readonly [number, number, number, number] => {
  const r = srgbToLinear(color.r);
  const g = srgbToLinear(color.g);
  const b = srgbToLinear(color.b);
  if (color.colorSpace === 'srgb') return [r, g, b, color.a];
  // Linear Display-P3 to linear sRGB. Extended values are retained for the
  // rgba16float document target and clipped only by final display conversion.
  return [
    1.22474527 * r - 0.22490437 * g - 0.00000004 * b,
    -0.04205796 * r + 1.042081 * g - 0.000079 * b,
    -0.01964228 * r - 0.07865492 * g + 1.0985372 * b,
    color.a
  ];
};

const solidPaint = (paint: TextPaint | undefined, label: string) => {
  if (!paint) return null;
  if (paint.kind !== 'solid') {
    throw new Error(`${label} gradients require the vector gradient backend.`);
  }
  return { type: 'solid' as const, color: colorToLinearSrgb(paint.color) };
};

const textStyle = (run: RealizedGlyphRun, unitsPerEm: number): VectorStyle => {
  const drawsFill = run.renderingMode.includes('fill');
  const drawsStroke = run.renderingMode.includes('stroke');
  if (run.renderingMode.includes('clip') || run.renderingMode === 'clip') {
    throw new Error('PDF clipping text requires the vector clip-stack backend.');
  }
  const fill = drawsFill ? solidPaint(run.paint.fill, 'Text fill') : null;
  let stroke: VectorStyle['stroke'] = null;
  if (drawsStroke) {
    const source: TextStroke | undefined = run.paint.stroke;
    if (!source) throw new Error('Stroke text requires authored stroke paint.');
    const paint = solidPaint(source.paint, 'Text stroke');
    stroke = {
      paint: paint!,
      // Vector stroke geometry lives in font units before the glyph transform.
      width: source.width * unitsPerEm / run.fontSize,
      cap: source.cap,
      join: source.join,
      miterLimit: source.miterLimit,
      dash: [],
      dashOffset: 0
    };
  }
  return { fill, stroke, opacity: 1 };
};

const affineFromMatrix3 = (matrix: Float32Array, offset: number): AffineMatrix => {
  const [a, c, tx, b, d, ty, p, q, w] = matrix.subarray(offset, offset + 9);
  if (![a, b, c, d, tx, ty, p, q, w].every(Number.isFinite)
    || Math.abs(p!) > 1e-6 || Math.abs(q!) > 1e-6 || Math.abs(w! - 1) > 1e-6) {
    throw new Error('Outline text supports finite affine per-glyph transforms only.');
  }
  return { a: a!, b: b!, c: c!, d: d!, tx: tx!, ty: ty! };
};

const maximumScale = (matrix: AffineMatrix) => {
  const sum = matrix.a ** 2 + matrix.b ** 2 + matrix.c ** 2 + matrix.d ** 2;
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  return Math.sqrt(Math.max(0, (sum + Math.sqrt(Math.max(0, sum ** 2 - 4 * determinant ** 2))) / 2));
};

const outlineIdentity = (run: RealizedGlyphRun, glyphId: number) => serializeGlyphOutlineKey({
  fontFingerprintSha256: run.font.font.fingerprintSha256,
  faceIndex: run.font.font.faceIndex,
  glyphId,
  variationCoordinates: run.font.variableAxes,
  extractorVersion: GLYPH_OUTLINE_EXTRACTOR_VERSION
});

interface GlyphEntry {
  readonly run: RealizedGlyphRun;
  readonly runIndex: number;
  readonly glyphIndex: number;
  readonly glyphId: number;
  readonly outlineId: string;
}

export const prepareTextOutlineVectorDraws = async (
  repository: TextOutlineRepositoryPort,
  layout: RealizedTextLayout,
  identity: TextOutlinePreparationIdentity,
  signal?: AbortSignal
): Promise<PreparedTextOutlineVectorDraws> => {
  if (!Number.isFinite(identity.sourceScale) || identity.sourceScale <= 0) {
    throw new TypeError('Text outline source scale must be finite and positive.');
  }
  const entries: GlyphEntry[] = layout.glyphRuns.flatMap((run, runIndex) => {
    if (run.font.syntheticBold || run.font.syntheticItalic) {
      throw new Error('Synthetic text styles require outline synthesis before vector rendering.');
    }
    return [...run.glyphIds].map((glyphId, glyphIndex) => ({
      run, runIndex, glyphIndex, glyphId, outlineId: outlineIdentity(run, glyphId)
    }));
  });
  const unique = new Map(entries.map((entry) => [entry.outlineId, entry]));
  const outlines = new Map<string, TextWorkerGlyphOutlineResult>();
  // The worker serializes WASM access; a small bounded client window prevents
  // large documents from materializing thousands of pending promises.
  const queue = [...unique.values()];
  const workers = Array.from({ length: Math.min(8, queue.length) }, async () => {
    while (queue.length > 0) {
      if (signal?.aborted) throw new DOMException('Text outline preparation was cancelled.', 'AbortError');
      const entry = queue.shift()!;
      const resolution = await repository.resolve({
        documentSessionId: identity.documentSessionId,
        sessionGeneration: identity.sessionGeneration,
        fontSnapshotRevision: identity.fontSnapshotRevision,
        font: entry.run.font.font,
        glyphId: entry.glyphId,
        variationCoordinates: entry.run.font.variableAxes
      }, signal);
      outlines.set(entry.outlineId, resolution.outline);
    }
  });
  await Promise.all(workers);

  const sourceTransform = scaleMatrix(identity.sourceScale, identity.sourceScale);
  const draws = entries.flatMap<TextOutlineVectorDraw>((entry) => {
    const glyphOutline = outlines.get(entry.outlineId)!;
    const x = entry.run.geometry[entry.glyphIndex * 4]!;
    const y = entry.run.geometry[entry.glyphIndex * 4 + 1]!;
    const fontScale = entry.run.fontSize / glyphOutline.unitsPerEm;
    let transform = multiplyMatrices(
      translationMatrix(x, y),
      scaleMatrix(fontScale, -fontScale)
    );
    if (entry.run.transforms) {
      transform = multiplyMatrices(
        translationMatrix(x, y),
        multiplyMatrices(
          affineFromMatrix3(entry.run.transforms, entry.glyphIndex * 9),
          scaleMatrix(fontScale, -fontScale)
        )
      );
    }
    transform = multiplyMatrices(sourceTransform, transform);
    const base = glyphOutlineToVectorPath(glyphOutline, {
      id: `text-outline:${entry.outlineId}`,
      name: `Glyph ${entry.glyphId}`
    });
    base.transform = transform;
    base.transformRevision = 1;
    base.style = textStyle(entry.run, glyphOutline.unitsPerEm);
    const glyphScale = maximumScale(transform);
    const requestedTolerance = glyphScale > 0 ? DEFAULT_SOURCE_TOLERANCE / glyphScale : DEFAULT_SOURCE_TOLERANCE;
    const geometry = realizeVectorPath(base, requestedTolerance);
    return geometry.subpaths.some(({ points }) => points.length > 0)
      ? [{ path: base, geometry, runIndex: entry.runIndex, glyphIndex: entry.glyphIndex }]
      : [];
  });
  return Object.freeze({ draws: Object.freeze(draws), uniqueOutlineCount: unique.size });
};
