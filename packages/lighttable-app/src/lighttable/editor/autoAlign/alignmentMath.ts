import type { Rect } from '../document/documentTypes';
import {
  invertMatrix,
  multiplyMatrices,
  transformedBounds
} from '../tools/transform/affine';
import type { AffineMatrix, RasterRenderContract } from '../rendering/renderContract';
import type {
  AlignmentCandidateScore,
  AlignmentDiagnostics,
  AlignmentSpace,
  TranslationAlignmentResult
} from './alignmentTypes';

/** Applies an alignment correction without discarding existing layer geometry. */
export const alignedTargetTransform = (
  currentTransform: AffineMatrix,
  result: TranslationAlignmentResult
) => multiplyMatrices(result.correctionMatrix, currentTransform);

export const intersectRects = (left: Rect, right: Rect): Rect | null => {
  const x = Math.max(left.x, right.x);
  const y = Math.max(left.y, right.y);
  const rightEdge = Math.min(left.x + left.width, right.x + right.width);
  const bottomEdge = Math.min(left.y + left.height, right.y + right.height);
  return rightEdge > x && bottomEdge > y
    ? { x, y, width: rightEdge - x, height: bottomEdge - y }
    : null;
};

export const contractDocumentBounds = (contract: RasterRenderContract<unknown>) =>
  transformedBounds(contract.transform, contract.bounds);

export const alignmentSpaceForContracts = (
  reference: RasterRenderContract<unknown>,
  target: RasterRenderContract<unknown>,
  maximumDimension: number
): AlignmentSpace | null => {
  const overlap = intersectRects(contractDocumentBounds(reference), contractDocumentBounds(target));
  if (!overlap) return null;
  const safeMaximum = Math.max(16, Math.floor(maximumDimension));
  const scale = safeMaximum / Math.max(overlap.width, overlap.height);
  return {
    documentBounds: overlap,
    analysisWidth: Math.max(1, Math.round(overlap.width * scale)),
    analysisHeight: Math.max(1, Math.round(overlap.height * scale)),
    documentPixelsPerAnalysisPixel: 1 / scale
  };
};

export const chooseBestTranslation = (
  scores: AlignmentCandidateScore[],
  referenceValidPixels: number,
  referenceLayerId: TranslationAlignmentResult['referenceLayerId'],
  targetLayerId: TranslationAlignmentResult['targetLayerId'],
  analysisToDocumentScale: number
): TranslationAlignmentResult | null => {
  return chooseBestAlignment(
    scores,
    referenceValidPixels,
    referenceLayerId,
    targetLayerId,
    {
      documentBounds: {
        x: 0,
        y: 0,
        width: 1 / analysisToDocumentScale,
        height: 1 / analysisToDocumentScale
      },
      analysisWidth: 1,
      analysisHeight: 1,
      documentPixelsPerAnalysisPixel: analysisToDocumentScale
    }
  );
};

export const chooseBestAlignment = (
  scores: AlignmentCandidateScore[],
  referenceValidPixels: number,
  referenceLayerId: TranslationAlignmentResult['referenceLayerId'],
  targetLayerId: TranslationAlignmentResult['targetLayerId'],
  space: AlignmentSpace
): TranslationAlignmentResult | null => {
  if (!scores.length || referenceValidPixels <= 0) return null;
  const normalized = scores
    .filter((score) => score.validPixelCount > 0 && score.weightSum > 1e-8 && Number.isFinite(score.errorSum))
    .map((score) => ({
      ...score,
      error: score.errorSum / score.weightSum,
      overlap: Math.min(1, score.validPixelCount / referenceValidPixels)
    }))
    .sort((left, right) => left.error - right.error);
  const best = normalized[0];
  if (!best) return null;
  const second = normalized.find((candidate) =>
    Math.abs(candidate.dx - best.dx) > 1
    || Math.abs(candidate.dy - best.dy) > 1
    || Math.abs(Math.log((candidate.scale ?? 1) / (best.scale ?? 1))) > 0.015
    || Math.abs((candidate.rotation ?? 0) - (best.rotation ?? 0)) > Math.PI / 360
  ) ?? normalized[1] ?? best;
  const identity = normalized.find((candidate) =>
    candidate.dx === 0
    && candidate.dy === 0
    && Math.abs((candidate.scale ?? 1) - 1) < 1e-6
    && Math.abs(candidate.rotation ?? 0) < 1e-6
  ) ?? best;
  const improvementFromIdentity = identity.error > 1e-8
    ? Math.max(0, Math.min(1, 1 - best.error / identity.error))
    : 0;
  const separation = second.error > 1e-8
    ? Math.max(0, Math.min(1, 1 - best.error / second.error))
    : 0;
  const overlapScore = Math.max(0, Math.min(1, (best.overlap - 0.15) / 0.7));
  // With cosine direction error an unrelated field tends toward 0.5, while
  // a useful registration remains well below it even after interpolation or
  // a local AI edit. Do not expect a near-zero photographic residual.
  const matchQuality = Math.max(0, Math.min(1, (0.5 - best.error) / 0.45));
  const confidence = Math.max(0, Math.min(
    1,
    improvementFromIdentity * 0.3 + separation * 0.1 + overlapScore * 0.2 + matchQuality * 0.4
  ));
  const scale = best.scale ?? 1;
  const rotation = best.rotation ?? 0;
  const offsetX = best.dx * space.documentPixelsPerAnalysisPixel;
  const offsetY = best.dy * space.documentPixelsPerAnalysisPixel;
  const diagnostics: AlignmentDiagnostics = {
    bestError: best.error,
    secondBestError: second.error,
    identityError: identity.error,
    improvementFromIdentity,
    separation,
    overlap: best.overlap,
    validPixelCount: best.validPixelCount,
    estimatedScale: scale,
    estimatedRotationDegrees: rotation * 180 / Math.PI,
    estimatedOffsetX: offsetX,
    estimatedOffsetY: offsetY
  };
  const cosine = Math.cos(rotation) * scale;
  const sine = Math.sin(rotation) * scale;
  const centerX = space.documentBounds.x + space.documentBounds.width / 2;
  const centerY = space.documentBounds.y + space.documentBounds.height / 2;
  // This matrix describes where target samples were found for each reference
  // point. Its inverse is the geometry correction applied to the target layer.
  const referenceToTarget: AffineMatrix = {
    a: cosine,
    b: sine,
    c: -sine,
    d: cosine,
    tx: centerX + offsetX - cosine * centerX + sine * centerY,
    ty: centerY + offsetY - sine * centerX - cosine * centerY
  };
  const invertedCorrection = invertMatrix(referenceToTarget);
  if (!invertedCorrection) return null;
  const cleanZero = (value: number) => Math.abs(value) < 1e-12 ? 0 : value;
  const correctionMatrix: AffineMatrix = {
    a: cleanZero(invertedCorrection.a),
    b: cleanZero(invertedCorrection.b),
    c: cleanZero(invertedCorrection.c),
    d: cleanZero(invertedCorrection.d),
    tx: cleanZero(invertedCorrection.tx),
    ty: cleanZero(invertedCorrection.ty)
  };
  return {
    model: Math.abs(scale - 1) > 1e-4 || Math.abs(rotation) > 1e-5
      ? 'similarity'
      : 'translation',
    referenceLayerId,
    targetLayerId,
    correctionMatrix,
    confidence,
    overlap: best.overlap,
    residualError: best.error,
    diagnostics
  };
};
