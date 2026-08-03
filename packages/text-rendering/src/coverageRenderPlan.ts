import type { Matrix3, RealizedTextLayout, RgbaColor } from '@lighttable/text-core';
import {
  COVERAGE_ATLAS_RASTERIZER_VERSION,
  quantizeCoveragePpem,
  type CoverageAtlasGlyphKey
} from './coverageAtlasCache';

export interface CoverageRasterRequestPlan {
  readonly key: CoverageAtlasGlyphKey;
  readonly assetId: string;
  readonly faceIndex: number;
  readonly glyphId: number;
  readonly ppem: number;
  readonly fontSnapshotRevision: number;
}

export interface CoverageGlyphDrawPlan {
  readonly raster: CoverageRasterRequestPlan;
  readonly x: number;
  readonly y: number;
  readonly transform: readonly [number, number, number, number];
  readonly color: readonly [number, number, number, number];
}

export interface CoverageRenderPlan {
  readonly layoutKey: string;
  readonly glyphs: readonly CoverageGlyphDrawPlan[];
}

interface VisualClusterGroup {
  readonly cluster: number;
  readonly sequence: number;
  x: number;
  y: number;
  readonly glyphs: CoverageGlyphDrawPlan[];
}

export class UnsupportedCoverageTextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedCoverageTextError';
  }
}

const srgbChannelToLinear = (channel: number) => (
  channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
);

const premultipliedLinearSrgb = (color: RgbaColor): readonly [number, number, number, number] => {
  if (color.colorSpace !== 'srgb') {
    throw new UnsupportedCoverageTextError('Slice 08 coverage text supports solid sRGB paint only.');
  }
  const alpha = color.a;
  return Object.freeze([
    srgbChannelToLinear(color.r) * alpha,
    srgbChannelToLinear(color.g) * alpha,
    srgbChannelToLinear(color.b) * alpha,
    alpha
  ]) as readonly [number, number, number, number];
};

const maximumSingularValue = (a: number, b: number, c: number, d: number) => {
  const sumSquares = a * a + b * b + c * c + d * d;
  const determinant = a * d - b * c;
  return Math.sqrt(Math.max(0, (sumSquares + Math.sqrt(Math.max(0, sumSquares ** 2 - 4 * determinant ** 2))) / 2));
};

/**
 * Produces an immutable, painter-ordered plan. Viewport zoom is deliberately
 * absent from this contract: only the layer-to-document transform selects a
 * hinted mask bucket, keeping zooming from thrashing the atlas.
 */
export const planCoverageText = (
  layout: RealizedTextLayout,
  localToDocument: Matrix3,
  fontSnapshotRevision: number
): CoverageRenderPlan => {
  const [a, c, tx, b, d, ty, p, q, w] = localToDocument;
  if (p !== 0 || q !== 0 || w !== 1) {
    throw new UnsupportedCoverageTextError('Perspective text transforms are not supported by the coverage atlas.');
  }
  const documentScale = maximumSingularValue(a, b, c, d);
  if (!Number.isFinite(documentScale) || documentScale <= 0) {
    throw new UnsupportedCoverageTextError('Text transform must have a finite positive scale.');
  }
  const visualGroups: VisualClusterGroup[] = [];
  let sequence = 0;
  for (const run of layout.glyphRuns) {
    if (run.renderingMode !== 'fill' || !run.paint.fill || run.paint.stroke) {
      throw new UnsupportedCoverageTextError('Slice 08 coverage text supports fill-only runs.');
    }
    if (run.paint.fill.kind !== 'solid') {
      throw new UnsupportedCoverageTextError('Slice 08 coverage text supports solid paint only.');
    }
    if (run.transforms) {
      throw new UnsupportedCoverageTextError('Per-glyph transforms are deferred beyond Slice 08.');
    }
    if (run.direction !== 'ltr' && run.direction !== 'rtl') {
      throw new UnsupportedCoverageTextError('Vertical coverage text is deferred beyond Slice 08.');
    }
    if (Object.keys(run.font.variableAxes).length > 0
      || run.font.syntheticBold || run.font.syntheticItalic) {
      throw new UnsupportedCoverageTextError('Variable and synthesized coverage glyphs are deferred beyond Slice 08.');
    }
    const ppem = quantizeCoveragePpem(run.fontSize * documentScale);
    const residual = run.fontSize / ppem;
    const color = premultipliedLinearSrgb(run.paint.fill.color);
    const variationCoordinates = Object.freeze(Object.fromEntries(
      Object.entries(run.font.variableAxes)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    ));
    let activeGroup: VisualClusterGroup | null = null;
    for (let glyphIndex = 0; glyphIndex < run.glyphIds.length; glyphIndex += 1) {
      const x = run.geometry[glyphIndex * 4];
      const y = run.geometry[glyphIndex * 4 + 1];
      const cluster = run.clusters[glyphIndex];
      if (!activeGroup || activeGroup.cluster !== cluster) {
        activeGroup = { cluster, sequence: sequence++, x, y, glyphs: [] };
        visualGroups.push(activeGroup);
      } else {
        activeGroup.x = Math.min(activeGroup.x, x);
        activeGroup.y = Math.min(activeGroup.y, y);
      }
      const key: CoverageAtlasGlyphKey = Object.freeze({
        fontFingerprintSha256: run.font.font.fingerprintSha256,
        faceIndex: run.font.font.faceIndex,
        glyphId: run.glyphIds[glyphIndex],
        variationCoordinates,
        syntheticBold: run.font.syntheticBold,
        syntheticItalic: run.font.syntheticItalic,
        hinting: 'smooth', ppem, renderMode: 'alpha',
        rasterizerVersion: COVERAGE_ATLAS_RASTERIZER_VERSION
      });
      activeGroup.glyphs.push(Object.freeze({
        raster: Object.freeze({
          key, assetId: run.font.font.assetId, faceIndex: key.faceIndex,
          glyphId: key.glyphId, ppem, fontSnapshotRevision
        }),
        x: a * x + c * y + tx,
        y: b * x + d * y + ty,
        transform: Object.freeze([a * residual, b * residual, c * residual, d * residual]) as
          readonly [number, number, number, number],
        color
      }));
    }
  }
  // Worker tables are logical-cluster ordered. Paint complete clusters in
  // stable visual plane order while retaining glyph order inside each cluster.
  visualGroups.sort((left, right) => {
    const vertical = left.y - right.y;
    if (Math.abs(vertical) > 1e-4) return vertical;
    const horizontal = left.x - right.x;
    return Math.abs(horizontal) > 1e-4 ? horizontal : left.sequence - right.sequence;
  });
  const glyphs = visualGroups.flatMap((group) => group.glyphs);
  return Object.freeze({ layoutKey: layout.key, glyphs: Object.freeze(glyphs) });
};
