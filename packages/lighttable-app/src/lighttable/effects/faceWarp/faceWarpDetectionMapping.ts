import { invertMatrix, transformPoint, type AffineMatrix } from '../../editor/geometry/affine';
import type { FaceWarpPoint } from './faceWarpTypes';

/** Maps detector-thumbnail coordinates back into immutable layer-source pixels. */
export const mapDetectedFaceToLayerSource = (
  mesh: readonly FaceWarpPoint[],
  sourceToThumbnail: AffineMatrix
): readonly FaceWarpPoint[] => {
  const thumbnailToSource = invertMatrix(sourceToThumbnail);
  if (!thumbnailToSource) throw new Error('The detector thumbnail transform is not invertible.');
  const linearScale = Math.sqrt(Math.abs(
    sourceToThumbnail.a * sourceToThumbnail.d
      - sourceToThumbnail.b * sourceToThumbnail.c
  ));
  return mesh.map((point) => ({
    ...transformPoint(thumbnailToSource, point),
    z: point.z === undefined || linearScale <= 0 ? point.z : point.z / linearScale
  }));
};
