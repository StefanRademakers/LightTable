import { useEffect, useLayoutEffect } from 'react';
import type { FaceWarpInteractionSessionController } from '../../application/tools/faceWarp/FaceWarpInteractionSessionController';
import type { FaceWarpDetectionReviewController } from '../../application/tools/faceWarp/FaceWarpDetectionReviewController';
import type { FaceWarpDetectionReviewSource } from '../../application/tools/faceWarp/faceWarpDetectionReview';

/** Retires only Face Warp work; transaction cleanup remains with its admitted controller. */
export const useFaceWarpLifecycle = (interaction: Pick<FaceWarpInteractionSessionController, 'reset'>,
  review: Pick<FaceWarpDetectionReviewController, 'reset' | 'synchronize' | 'dispose'>, session: object | undefined,
  lifecycle: object, generation: number, active: boolean,
  source: FaceWarpDetectionReviewSource | null
) => {
  useLayoutEffect(() => {
    interaction.reset(); review.reset();
    return () => { interaction.reset(); review.reset(); };
  }, [interaction, review, session, lifecycle, generation]);
  useLayoutEffect(() => {
    if (!active) { interaction.reset(); review.reset(); }
  }, [interaction, review, active]);
  useLayoutEffect(() => { review.synchronize(source); }, [review, source]);
  useEffect(() => () => { review.dispose(); }, [review]);
};
