import type { TextLayerSourceMode } from './TextLayerRenderer';

export type TextSourceCostPhase = 'atlas-composite' | 'cache-build' | 'cached-composite';

export interface TextSourceCostSample {
  readonly phase: TextSourceCostPhase;
  readonly durationMs: number;
  readonly glyphCount: number;
  readonly pixelCount: number;
}

export interface TextSourceDecisionInput {
  readonly glyphCount: number;
  readonly pixelCount: number;
  readonly byteLength: number;
  readonly expectedRecompositions: number;
  readonly availableCacheBytes: number;
  readonly directEligible: boolean;
}

export interface TextSourceModeDecision {
  readonly mode: TextLayerSourceMode;
  readonly reason: 'direct-ineligible' | 'budget' | 'lower-estimated-cost';
  readonly estimatedDirectMs: number;
  readonly estimatedCachedMs: number;
  readonly estimatedSavingsMs: number;
  readonly measurementCount: number;
}

export interface TextSourceCostModelSnapshot {
  readonly measurementCount: number;
  readonly decisions: Readonly<Record<TextLayerSourceMode, number>>;
  readonly lastDecision: TextSourceModeDecision | null;
  readonly coefficients: Readonly<{
    atlasFixedMs: number;
    atlasGlyphMs: number;
    cacheFixedMs: number;
    cacheGlyphMs: number;
    cachePixelMs: number;
    cachedFixedMs: number;
    cachedPixelMs: number;
  }>;
}

interface CostCoefficients {
  atlasFixedMs: number;
  atlasGlyphMs: number;
  cacheFixedMs: number;
  cacheGlyphMs: number;
  cachePixelMs: number;
  cachedFixedMs: number;
  cachedPixelMs: number;
}

const DEFAULT_COEFFICIENTS: CostCoefficients = {
  atlasFixedMs: 0.035,
  atlasGlyphMs: 0.0012,
  cacheFixedMs: 0.08,
  cacheGlyphMs: 0.0012,
  cachePixelMs: 0.000004,
  cachedFixedMs: 0.02,
  cachedPixelMs: 0.0000008
};

const finiteNonNegative = (value: number, label: string) => {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be finite and non-negative.`);
  }
  return value;
};

const positiveInteger = (value: number, label: string) => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive safe integer.`);
  }
  return value;
};

const blend = (current: number, observed: number, weight: number) => (
  current * (1 - weight) + observed * weight
);

/**
 * Document-local rolling model for choosing atlas composition or a persistent
 * tight source. Samples are normalized by work units, so decisions remain
 * deterministic and serializable without exposing a user-facing cache switch.
 */
export class TextSourceCostModel {
  private coefficients: CostCoefficients = { ...DEFAULT_COEFFICIENTS };
  private measurementCount = 0;
  private decisions = { atlas: 0, cached: 0 };
  private lastDecision: TextSourceModeDecision | null = null;

  observe(sample: TextSourceCostSample) {
    const durationMs = finiteNonNegative(sample.durationMs, 'durationMs');
    const glyphCount = positiveInteger(sample.glyphCount, 'glyphCount');
    const pixelCount = positiveInteger(sample.pixelCount, 'pixelCount');
    const weight = this.measurementCount < 8 ? 0.35 : 0.12;
    if (sample.phase === 'atlas-composite') {
      const observed = Math.max(0, durationMs - this.coefficients.atlasFixedMs) / glyphCount;
      this.coefficients.atlasGlyphMs = blend(this.coefficients.atlasGlyphMs, observed, weight);
    } else if (sample.phase === 'cache-build') {
      const residual = Math.max(0, durationMs - this.coefficients.cacheFixedMs);
      const observedGlyph = residual / (glyphCount + pixelCount / 256);
      this.coefficients.cacheGlyphMs = blend(this.coefficients.cacheGlyphMs, observedGlyph, weight);
      this.coefficients.cachePixelMs = blend(
        this.coefficients.cachePixelMs,
        residual / (pixelCount + glyphCount * 256),
        weight
      );
    } else {
      const observed = Math.max(0, durationMs - this.coefficients.cachedFixedMs) / pixelCount;
      this.coefficients.cachedPixelMs = blend(this.coefficients.cachedPixelMs, observed, weight);
    }
    this.measurementCount += 1;
  }

  decide(input: TextSourceDecisionInput): TextSourceModeDecision {
    const glyphCount = positiveInteger(input.glyphCount, 'glyphCount');
    const pixelCount = positiveInteger(input.pixelCount, 'pixelCount');
    const byteLength = positiveInteger(input.byteLength, 'byteLength');
    const expected = positiveInteger(input.expectedRecompositions, 'expectedRecompositions');
    const available = finiteNonNegative(input.availableCacheBytes, 'availableCacheBytes');
    const atlasOnce = this.coefficients.atlasFixedMs + glyphCount * this.coefficients.atlasGlyphMs;
    const cachedOnce = this.coefficients.cachedFixedMs + pixelCount * this.coefficients.cachedPixelMs;
    const cacheBuild = this.coefficients.cacheFixedMs
      + glyphCount * this.coefficients.cacheGlyphMs
      + pixelCount * this.coefficients.cachePixelMs;
    const estimatedDirectMs = atlasOnce * expected;
    const estimatedCachedMs = cacheBuild + cachedOnce * expected;
    const estimatedSavingsMs = estimatedDirectMs - estimatedCachedMs;
    const minimumSavings = Math.max(0.1, cacheBuild * 0.1);
    let mode: TextLayerSourceMode;
    let reason: TextSourceModeDecision['reason'];
    if (!input.directEligible) {
      mode = 'cached';
      reason = 'direct-ineligible';
    } else if (byteLength > available) {
      mode = 'atlas';
      reason = 'budget';
    } else {
      mode = estimatedSavingsMs > minimumSavings ? 'cached' : 'atlas';
      reason = 'lower-estimated-cost';
    }
    const decision = Object.freeze({
      mode,
      reason,
      estimatedDirectMs,
      estimatedCachedMs,
      estimatedSavingsMs,
      measurementCount: this.measurementCount
    });
    this.decisions[mode] += 1;
    this.lastDecision = decision;
    return decision;
  }

  snapshot(): TextSourceCostModelSnapshot {
    return Object.freeze({
      measurementCount: this.measurementCount,
      decisions: Object.freeze({ ...this.decisions }),
      lastDecision: this.lastDecision,
      coefficients: Object.freeze({ ...this.coefficients })
    });
  }
}
