import type { FaceWarpLandmarks, FaceWarpPoint } from './faceWarpTypes';

const average = (mesh: readonly FaceWarpPoint[], indices: readonly number[]): FaceWarpPoint => {
  const points = indices.map((index) => mesh[index]).filter((point): point is FaceWarpPoint => Boolean(point));
  if (points.length === 0) throw new Error('The detected face mesh is incomplete.');
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length
  };
};

/** Maps MediaPipe's stable 478-point topology to semantic edit handles. */
export const semanticLandmarksFromMesh = (mesh: readonly FaceWarpPoint[]): FaceWarpLandmarks => {
  if (mesh.length < 468) throw new Error(`Expected at least 468 face landmarks, received ${mesh.length}.`);
  return {
    mesh: structuredClone(mesh),
    faceTop: average(mesh, [10]),
    chin: average(mesh, [152]),
    leftCheek: average(mesh, [234]),
    rightCheek: average(mesh, [454]),
    leftEye: average(mesh, [33, 133, 159, 145]),
    rightEye: average(mesh, [362, 263, 386, 374]),
    noseTop: average(mesh, [168]),
    noseTip: average(mesh, [1]),
    noseLeft: average(mesh, [98]),
    noseRight: average(mesh, [327]),
    mouthLeft: average(mesh, [61]),
    mouthRight: average(mesh, [291]),
    mouthTop: average(mesh, [13]),
    mouthBottom: average(mesh, [14])
  };
};
