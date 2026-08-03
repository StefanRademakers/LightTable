import type { RealizedGlyphRun, RealizedTextLayout } from '@lighttable/text-core';
import { COVERAGE_PPEM_BUCKETS } from './coverageAtlasCache';

export type TextRealizationRoute = 'coverage-atlas' | 'outline-vector';

export type TextRealizationReason =
  | 'fast-interactive-coverage'
  | 'output-quality'
  | 'coverage-scale-limit'
  | 'stroke'
  | 'gradient-paint'
  | 'glyph-transform'
  | 'variable-font'
  | 'synthetic-style'
  | 'vertical-writing'
  | 'pdf-rendering-mode';

export interface TextRealizationRequest {
  /** Largest singular value of the authored layer-to-document transform. */
  readonly documentScale: number;
  /** Export/downsample target scale relative to document pixels. */
  readonly outputScale?: number;
  readonly purpose: 'interactive' | 'final-output';
}

export interface TextRealizationDecision {
  readonly route: TextRealizationRoute;
  readonly reason: TextRealizationReason;
  readonly targetPpem: number;
}

const runReason = (run: RealizedGlyphRun): TextRealizationReason | null => {
  if (run.renderingMode !== 'fill') return 'pdf-rendering-mode';
  if (run.paint.stroke) return 'stroke';
  if (run.paint.fill?.kind === 'linear-gradient') return 'gradient-paint';
  if (run.transforms) return 'glyph-transform';
  if (Object.keys(run.font.variableAxes).length > 0) return 'variable-font';
  if (run.font.syntheticBold || run.font.syntheticItalic) return 'synthetic-style';
  if (run.direction === 'ttb' || run.direction === 'btt') return 'vertical-writing';
  return null;
};

/**
 * Selects content realization from authored document/output requirements.
 * Viewport zoom is intentionally not part of this contract: zooming presents
 * the already-rendered document pixels and cannot churn text caches.
 */
export const selectTextRealizationRoute = (
  layout: RealizedTextLayout,
  request: TextRealizationRequest
): TextRealizationDecision => {
  const outputScale = request.outputScale ?? 1;
  if (!Number.isFinite(request.documentScale) || request.documentScale <= 0) {
    throw new TypeError('Text document scale must be finite and positive.');
  }
  if (!Number.isFinite(outputScale) || outputScale <= 0) {
    throw new TypeError('Text output scale must be finite and positive.');
  }
  const targetPpem = layout.glyphRuns.reduce(
    (maximum, run) => Math.max(maximum, run.fontSize * request.documentScale * outputScale),
    0
  );
  if (request.purpose === 'final-output') {
    return { route: 'outline-vector', reason: 'output-quality', targetPpem };
  }
  for (const run of layout.glyphRuns) {
    const reason = runReason(run);
    if (reason) return { route: 'outline-vector', reason, targetPpem };
  }
  const maximumCoveragePpem = COVERAGE_PPEM_BUCKETS.at(-1)!;
  if (targetPpem > maximumCoveragePpem) {
    return { route: 'outline-vector', reason: 'coverage-scale-limit', targetPpem };
  }
  return { route: 'coverage-atlas', reason: 'fast-interactive-coverage', targetPpem };
};
