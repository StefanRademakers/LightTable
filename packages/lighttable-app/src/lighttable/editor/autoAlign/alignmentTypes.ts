import type { LayerId, Rect } from '../document/documentTypes';
import type { AffineMatrix } from '../rendering/renderContract';

export interface TranslationAlignmentOptions {
  analysisSize: number;
  maxTranslationPixels: number;
  minimumScale: number;
  maximumScale: number;
  maximumRotationDegrees: number;
  minimumOverlap: number;
  minimumConfidence: number;
}

export interface AlignmentDiagnostics {
  bestError: number;
  secondBestError: number;
  identityError: number;
  improvementFromIdentity: number;
  separation: number;
  overlap: number;
  validPixelCount: number;
  /** Reference-to-target scale found in analysis space. */
  estimatedScale?: number;
  /** Reference-to-target clockwise rotation in degrees. */
  estimatedRotationDegrees?: number;
  /** Reference-to-target offset in document pixels. */
  estimatedOffsetX?: number;
  estimatedOffsetY?: number;
  algorithm?: 'legacy' | 'feature-v2';
  detectedReferenceFeatures?: number;
  detectedTargetFeatures?: number;
  mutualMatches?: number;
  inlierCount?: number;
  inlierRatio?: number;
  coverageCells?: number;
  coverageRatio?: number;
  medianResidual?: number;
  p90Residual?: number;
}

export interface TranslationAlignmentResult {
  model: 'translation' | 'similarity';
  referenceLayerId: LayerId;
  targetLayerId: LayerId;
  correctionMatrix: AffineMatrix;
  confidence: number;
  overlap: number;
  residualError: number;
  diagnostics: AlignmentDiagnostics;
}

export interface AlignmentCandidateScore {
  dx: number;
  dy: number;
  /** Maps reference analysis coordinates to target analysis coordinates. */
  scale?: number;
  /** Clockwise reference-to-target rotation in radians. */
  rotation?: number;
  errorSum: number;
  weightSum: number;
  validPixelCount: number;
}

export interface AlignmentSpace {
  documentBounds: Rect;
  analysisWidth: number;
  analysisHeight: number;
  documentPixelsPerAnalysisPixel: number;
}

export const DEFAULT_TRANSLATION_ALIGNMENT_OPTIONS: TranslationAlignmentOptions = {
  // Keep the prototype analysis target deliberately small. The current
  // scorer evaluates every pixel for every transform candidate, so doubling
  // this dimension would quadruple its dominant GPU workload.
  analysisSize: 128,
  maxTranslationPixels: 128,
  minimumScale: 0.6,
  maximumScale: 1.67,
  // Conservative default: position + uniform scale. Rotation needs a
  // separately validated, multi-resolution motion model before it is safe.
  maximumRotationDegrees: 0,
  minimumOverlap: 0.2,
  minimumConfidence: 0.55
};
