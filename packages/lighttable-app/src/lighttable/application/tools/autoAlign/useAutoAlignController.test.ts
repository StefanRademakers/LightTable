import { describe, expect, it } from 'vitest';
import type { TranslationAlignmentResult } from '../../../editor/autoAlign/alignmentTypes';
import { formatAutoAlignPreviewStatus } from './useAutoAlignController';

const result = (overrides: Partial<TranslationAlignmentResult> = {}): TranslationAlignmentResult => ({
  model: 'similarity',
  referenceLayerId: 'reference' as TranslationAlignmentResult['referenceLayerId'],
  targetLayerId: 'target' as TranslationAlignmentResult['targetLayerId'],
  correctionMatrix: { a: 1, b: 0, c: 0, d: 1, tx: 4, ty: -2 },
  confidence: 0.84,
  overlap: 0.9,
  residualError: 0.75,
  diagnostics: {
    bestError: 0.5,
    secondBestError: 0.9,
    identityError: 4,
    improvementFromIdentity: 0.875,
    separation: 0.8,
    overlap: 0.9,
    validPixelCount: 100,
    estimatedScale: 1.02,
    estimatedRotationDegrees: -1.25,
    mutualMatches: 80,
    inlierCount: 64,
    coverageCells: 12,
    medianResidual: 0.75
  },
  ...overrides
});

describe('formatAutoAlignPreviewStatus', () => {
  it('reports geometric evidence and corrections', () => {
    expect(formatAutoAlignPreviewStatus(result())).toBe(
      'Auto Align scale / rotate / move preview · 64/80 inliers · 12/16 regions · 0.75 px residual · 98.0% correction · 1.25° correction'
    );
  });

  it('falls back to confidence when feature counts are unavailable', () => {
    const translation = result({
      model: 'translation',
      confidence: 0.61,
      diagnostics: {
        ...result().diagnostics,
        inlierCount: undefined,
        mutualMatches: undefined,
        coverageCells: undefined,
        medianResidual: undefined,
        estimatedScale: undefined,
        estimatedRotationDegrees: undefined
      }
    });
    expect(formatAutoAlignPreviewStatus(translation)).toBe(
      'Auto Align move preview · 61% confidence'
    );
  });
});
