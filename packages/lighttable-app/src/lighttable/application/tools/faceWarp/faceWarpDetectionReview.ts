import type { AffineMatrix } from '../../../editor/geometry/affine';
import type { LayerId } from '../../../editor/document/documentTypes';

export interface FaceWarpDetectionReviewSource {
  readonly documentId: string;
  readonly layerId: LayerId;
  readonly pixelRevision: number;
  readonly transform: AffineMatrix;
}

export const faceWarpDetectionReviewMatches = (
  expected: FaceWarpDetectionReviewSource,
  current: FaceWarpDetectionReviewSource | null
): boolean => current !== null
  && current.documentId === expected.documentId
  && current.layerId === expected.layerId
  && current.pixelRevision === expected.pixelRevision
  && current.transform.a === expected.transform.a
  && current.transform.b === expected.transform.b
  && current.transform.c === expected.transform.c
  && current.transform.d === expected.transform.d
  && current.transform.tx === expected.transform.tx
  && current.transform.ty === expected.transform.ty;
