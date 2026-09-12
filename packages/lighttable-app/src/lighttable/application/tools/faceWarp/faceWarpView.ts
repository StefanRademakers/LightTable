import type { ImageDocument } from '../../../editor/document/documentTypes';
import { findRasterLayer } from '../../../editor/document/layerTree';
import { findFaceWarpModuleInstance, readFaceWarpNodeSettings, type FaceWarpFace } from '../../../effects/faceWarp/faceWarpTypes';
import type { FaceWarpDetectionSnapshot } from './FaceWarpDetectionReviewController';
import { faceWarpDetectionReviewMatches } from './faceWarpDetectionReview';

const NO_FACES: readonly FaceWarpFace[] = Object.freeze([]);
export const faceWarpReviewSource = (document: ImageDocument | null) => {
  const layer = document ? findRasterLayer(document, document.activeLayerId) : null;
  return document && layer ? { documentId: document.id, layerId: layer.id,
    pixelRevision: layer.pixelRevision, transform: layer.transform } : null;
};
export const resolveFaceWarpView = (document: ImageDocument | null, review: FaceWarpDetectionSnapshot) => {
  const layer = document ? findRasterLayer(document, document.activeLayerId) : null;
  const instance = layer ? findFaceWarpModuleInstance(layer.adjustmentStack) : null;
  const settings = instance ? readFaceWarpNodeSettings(instance) : null;
  const source = faceWarpReviewSource(document);
  const pending = review.pending && faceWarpDetectionReviewMatches(review.pending.source, source)
    ? review.pending : null;
  const acceptedFaces = settings?.faces ?? NO_FACES;
  const faces = pending?.settings.faces ?? acceptedFaces;
  const selectedFaceId = faces.some(({ id }) => id === review.selectedFaceId)
    ? review.selectedFaceId : faces[0]?.id ?? null;
  return { layer, settings, source, pending, acceptedFaces, faces, selectedFaceId };
};
export type FaceWarpView = ReturnType<typeof resolveFaceWarpView>;
