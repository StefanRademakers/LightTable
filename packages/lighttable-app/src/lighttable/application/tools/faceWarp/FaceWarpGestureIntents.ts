import type { ImageDocument } from '../../../editor/document/documentTypes';
import { findRasterLayer } from '../../../editor/document/layerTree';
import { setRasterLayerAdjustmentStack } from '../../../editor/document/documentCommands';
import { invertMatrix, transformPoint } from '../../../editor/geometry/affine';
import { applyFaceWarpBrush, findDeformedFaceHit, refineFaceWarpBrush,
  relaxFaceWarpBrush, restoreFaceWarpBrush } from '../../../effects/faceWarp/faceWarpDeformer';
import { findFaceWarpModuleInstance, readFaceWarpNodeSettings, setFaceWarpNodeSettings,
  type FaceWarpPoint } from '../../../effects/faceWarp/faceWarpTypes';
import { resolveFaceWarpEligibility } from '../../effects/faceWarp/faceWarpEligibility';
import type { FaceWarpInteractionMode, FaceWarpInteractionSessionController } from './FaceWarpInteractionSessionController';
import type { FaceWarpDetectionReviewController } from './FaceWarpDetectionReviewController';
import { faceWarpReviewSource } from './faceWarpView';
import { faceWarpDetectionReviewMatches } from './faceWarpDetectionReview';

/** Source-space hit/brush/refinement recipes; transaction and admitted target remain controller-owned. */
export class FaceWarpGestureIntents {
  constructor(private readonly controller: FaceWarpInteractionSessionController,
    private readonly review: Pick<FaceWarpDetectionReviewController, 'getSnapshot' | 'setSelectedFaceId'>,
    private readonly getDocument: () => ImageDocument | null,
    private readonly getBrush: () => { size: number; opacity: number },
    private readonly isCurrent: () => boolean, private readonly setError: (message: string) => void) {}

  begin = (pointerId: number, point: FaceWarpPoint) => {
    if (!this.isCurrent()) return false;
    const document = this.getDocument();
    if (!document?.activeLayerId) return false;
    const review = this.review.getSnapshot();
    if (review.pending && faceWarpDetectionReviewMatches(review.pending.source, faceWarpReviewSource(document))) return false;
    const eligibility = resolveFaceWarpEligibility(document, document.activeLayerId);
    if (!eligibility.ok) { this.setError(eligibility.reason); return false; }
    const { layer, settings } = eligibility;
    const inverse = invertMatrix(layer.transform);
    if (!inverse) return false;
    const sourcePoint = transformPoint(inverse, point);
    const faces = [...settings.faces.filter(({ id }) => id === review.selectedFaceId),
      ...settings.faces.filter(({ id }) => id !== review.selectedFaceId)];
    for (const face of faces) {
      const hit = findDeformedFaceHit(face, settings.topology.triangleIndices, sourcePoint);
      if (!hit) continue;
      if (!this.controller.beginGesture(document.id, layer.id, {
        pointerId, faceId: face.id, seedSource: hit.sourcePoint, startPointerSource: sourcePoint,
        originalDisplacements: face.displacements, latestRadius: 0, mode: 'sculpt'
      })) return false;
      this.review.setSelectedFaceId(face.id);
      return true;
    }
    return false;
  };
  move = (pointerId: number, point: FaceWarpPoint, mode: FaceWarpInteractionMode) => {
    if (!this.isCurrent()) return false;
    const brush = this.getBrush();
    return this.controller.changeGesture(pointerId, mode, (document, gesture) => {
      const layer = findRasterLayer(document, document.activeLayerId);
      const instance = layer ? findFaceWarpModuleInstance(layer.adjustmentStack) : null;
      const inverse = layer ? invertMatrix(layer.transform) : null;
      if (!layer?.adjustmentStack || !instance || !inverse) return document;
      const settings = readFaceWarpNodeSettings(instance);
      const sourcePoint = transformPoint(inverse, point);
      const scale = Math.sqrt(Math.max(1e-8, Math.abs(
        layer.transform.a * layer.transform.d - layer.transform.b * layer.transform.c)));
      const radius = brush.size * 0.5 / scale;
      gesture.latestRadius = radius;
      gesture.mode = mode;
      const faces = settings.faces.map(face => face.id !== gesture.faceId ? face : { ...face,
        displacements: mode === 'relax'
          ? relaxFaceWarpBrush(face, settings.topology.triangleIndices, sourcePoint, radius, 0.35)
          : mode === 'restore'
            ? restoreFaceWarpBrush(face, settings.topology.triangleIndices, sourcePoint, radius, 0.5)
            : applyFaceWarpBrush({ ...face, displacements: gesture.originalDisplacements },
              settings.topology.triangleIndices, gesture.seedSource,
              { x: sourcePoint.x - gesture.startPointerSource.x,
                y: sourcePoint.y - gesture.startPointerSource.y }, radius, brush.opacity)
      });
      return setRasterLayerAdjustmentStack(document, layer.id,
        setFaceWarpNodeSettings(layer.adjustmentStack, { ...settings, faces }));
    });
  };
  finish = (pointerId: number) => this.isCurrent() && this.controller.finishGesture(pointerId, (document, gesture) => {
    const layer = findRasterLayer(document, document.activeLayerId);
    const instance = layer ? findFaceWarpModuleInstance(layer.adjustmentStack) : null;
    if (!layer?.adjustmentStack || !instance) return document;
    const settings = readFaceWarpNodeSettings(instance);
    const faces = settings.faces.map(face => face.id !== gesture.faceId ? face : { ...face,
      displacements: refineFaceWarpBrush(face, settings.topology.triangleIndices,
        gesture.seedSource, gesture.latestRadius)
    });
    return setRasterLayerAdjustmentStack(document, layer.id,
      setFaceWarpNodeSettings(layer.adjustmentStack, { ...settings, faces }));
  });
  cancel = (pointerId: number) => this.isCurrent() && this.controller.cancelGesture(pointerId);
}
