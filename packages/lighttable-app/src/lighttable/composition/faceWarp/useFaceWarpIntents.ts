import { useLayoutEffect, useMemo, useRef } from 'react';
import type { ImageDocument } from '../../editor/document/documentTypes';
import type { FaceWarpSemanticTarget } from '../../effects/faceWarp/faceWarpOperations';
import type { FaceWarpInteractionSessionController } from '../../application/tools/faceWarp/FaceWarpInteractionSessionController';
import type { FaceWarpDetectionReviewController } from '../../application/tools/faceWarp/FaceWarpDetectionReviewController';
import { FaceWarpPropertyIntents } from '../../application/tools/faceWarp/FaceWarpPropertyIntents';
import { FaceWarpGestureIntents } from '../../application/tools/faceWarp/FaceWarpGestureIntents';
import { resolveFaceWarpView } from '../../application/tools/faceWarp/faceWarpView';

export const useFaceWarpIntents = (controller: FaceWarpInteractionSessionController,
  review: FaceWarpDetectionReviewController, session: object | undefined,
  renderer: object | null, generation: number, lifecycle: object, captureScope: () => { isCurrent(): boolean },
  read: () => { document: ImageDocument | null; brush: { size: number; opacity: number };
    target: FaceWarpSemanticTarget }, setError: (message: string) => void
) => {
  const latest = useRef({ read, setError, session });
  latest.current = { read, setError, session };
  const binding = useMemo(() => {
    const scope = captureScope();
    const lease = { mounted: false };
    const isCurrent = () => lease.mounted && latest.current.session === session && scope.isCurrent();
    const error = (message: string) => latest.current.setError(message);
    return { lease,
      cancelReview: () => {
        if (isCurrent()) review.cancel(resolveFaceWarpView(latest.current.read().document, review.getSnapshot()).acceptedFaces);
      },
      properties: new FaceWarpPropertyIntents(controller, () => {
        const inputs = latest.current.read();
        return { document: inputs.document, target: inputs.target,
          selectedFaceId: review.getSnapshot().selectedFaceId };
      }, isCurrent, error),
      gesture: new FaceWarpGestureIntents(controller, review, () => latest.current.read().document,
        () => latest.current.read().brush, isCurrent, error)
    };
  }, [controller, review, session, renderer, generation, lifecycle, captureScope]);
  useLayoutEffect(() => {
    binding.lease.mounted = true;
    return () => { binding.lease.mounted = false; };
  }, [binding]);
  return binding;
};
