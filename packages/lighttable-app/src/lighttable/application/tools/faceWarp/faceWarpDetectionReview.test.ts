import { describe, expect, it } from 'vitest';
import type { LayerId } from '../../../editor/document/documentTypes';
import {
  faceWarpDetectionReviewMatches,
  type FaceWarpDetectionReviewSource
} from './faceWarpDetectionReview';

const source = (change: Partial<FaceWarpDetectionReviewSource> = {}): FaceWarpDetectionReviewSource => ({
  documentId: 'document-1',
  layerId: 'layer-1' as LayerId,
  pixelRevision: 4,
  transform: { a: 1, b: 0, c: 0, d: 1, tx: 20, ty: 30 },
  ...change
});

describe('Face Warp detection review identity', () => {
  it('accepts only the exact source snapshot used by detection', () => {
    expect(faceWarpDetectionReviewMatches(source(), source())).toBe(true);
    expect(faceWarpDetectionReviewMatches(source(), null)).toBe(false);
    expect(faceWarpDetectionReviewMatches(source(), source({ documentId: 'document-2' }))).toBe(false);
    expect(faceWarpDetectionReviewMatches(source(), source({ layerId: 'layer-2' as LayerId }))).toBe(false);
    expect(faceWarpDetectionReviewMatches(source(), source({ pixelRevision: 5 }))).toBe(false);
    expect(faceWarpDetectionReviewMatches(source(), source({
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 21, ty: 30 }
    }))).toBe(false);
  });
});
