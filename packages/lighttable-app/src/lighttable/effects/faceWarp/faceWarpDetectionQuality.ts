import { MEDIAPIPE_FACE_VERTEX_COUNT } from './canonicalFaceTopology';
import type { FaceWarpPoint } from './faceWarpTypes';
import type { FaceWarpDetectorObservation } from './faceWarpDetectorProtocol';
import { facePoseYawDegrees } from './faceWarpPose';

export interface FaceWarpDetectionQuality {
  readonly accepted: boolean;
  readonly confidence: number;
  readonly reason?: string;
  readonly diagnostics?: Readonly<Record<string, number>>;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const OBSERVATION_MESH_VERTICES = [33, 263, 1, 13, 234, 454] as const;

export const faceWarpObservationAgreement = (
  mesh: readonly FaceWarpPoint[],
  observation: FaceWarpDetectorObservation | undefined
): number | null => {
  if (!observation || observation.keypoints.length < OBSERVATION_MESH_VERTICES.length
    || observation.bounds.width <= 0 || observation.bounds.height <= 0) return null;
  let squaredDistance = 0;
  for (let index = 0; index < OBSERVATION_MESH_VERTICES.length; index += 1) {
    const meshPoint = mesh[OBSERVATION_MESH_VERTICES[index]];
    const detectorPoint = observation.keypoints[index];
    if (!meshPoint || !detectorPoint) return null;
    squaredDistance += (meshPoint.x - detectorPoint.x) ** 2 + (meshPoint.y - detectorPoint.y) ** 2;
  }
  const scale = Math.max(1, Math.hypot(observation.bounds.width, observation.bounds.height));
  return Math.sqrt(squaredDistance / OBSERVATION_MESH_VERTICES.length) / scale;
};

export const matchFaceWarpObservations = (
  meshes: readonly (readonly FaceWarpPoint[])[],
  observations: readonly FaceWarpDetectorObservation[]
): readonly (FaceWarpDetectorObservation | undefined)[] => {
  const available = new Set(observations.map((_, index) => index));
  return meshes.map((mesh) => {
    let bestIndex: number | null = null;
    let bestAgreement = Number.POSITIVE_INFINITY;
    for (const index of available) {
      const agreement = faceWarpObservationAgreement(mesh, observations[index]);
      if (agreement !== null && agreement < bestAgreement) {
        bestAgreement = agreement;
        bestIndex = index;
      }
    }
    if (bestIndex === null) return undefined;
    available.delete(bestIndex);
    return observations[bestIndex];
  });
};

/**
 * Validates detector geometry before it becomes persistent document state.
 * MediaPipe Tasks does not expose its face-presence score in the JS result, so
 * this is an observation/geometry confidence rather than a fabricated ML
 * probability.
 */
export const assessFaceWarpDetection = (
  mesh: readonly FaceWarpPoint[],
  poseMatrix: readonly number[] | undefined,
  imageWidth: number,
  imageHeight: number,
  observation?: FaceWarpDetectorObservation
): FaceWarpDetectionQuality => {
  if (mesh.length < MEDIAPIPE_FACE_VERTEX_COUNT) {
    return { accepted: false, confidence: 0, reason: 'The detected face mesh is incomplete.' };
  }
  if (!(imageWidth > 0) || !(imageHeight > 0)) {
    return { accepted: false, confidence: 0, reason: 'The analyzed image has invalid dimensions.' };
  }
  const surface = mesh.slice(0, MEDIAPIPE_FACE_VERTEX_COUNT);
  if (surface.some(({ x, y, z }) => !Number.isFinite(x) || !Number.isFinite(y)
    || (z !== undefined && !Number.isFinite(z)))) {
    return { accepted: false, confidence: 0, reason: 'The detected face mesh contains invalid coordinates.' };
  }
  if (!poseMatrix || poseMatrix.length !== 16 || poseMatrix.some((value) => !Number.isFinite(value))) {
    return { accepted: false, confidence: 0, reason: 'The detected face pose is incomplete.' };
  }

  const xs = surface.map(({ x }) => x).sort((a, b) => a - b);
  const ys = surface.map(({ y }) => y).sort((a, b) => a - b);
  const low = Math.floor(surface.length * 0.02);
  const high = Math.ceil(surface.length * 0.98) - 1;
  const width = xs[high]! - xs[low]!;
  const height = ys[high]! - ys[low]!;
  if (width < Math.max(12, imageWidth * 0.025)
    || height < Math.max(12, imageHeight * 0.025)) {
    return { accepted: false, confidence: 0, reason: 'The detected face is too small or degenerate to edit safely.' };
  }

  const insideCount = surface.reduce((count, point) => count
    + Number(point.x >= 0 && point.x <= imageWidth && point.y >= 0 && point.y <= imageHeight), 0);
  const insideRatio = insideCount / surface.length;
  if (insideRatio < 0.55) {
    return { accepted: false, confidence: 0, reason: 'Too little of the detected face is visible in the layer.' };
  }

  const yaw = facePoseYawDegrees(poseMatrix);
  if (yaw === null || yaw > 72) {
    return {
      accepted: false,
      confidence: 0,
      reason: 'The face angle is too close to profile for a reliable editable mesh.'
    };
  }

  const observationAgreement = faceWarpObservationAgreement(surface, observation);
  if (observationAgreement !== null && observationAgreement > 0.07) {
    return {
      accepted: false,
      confidence: 0,
      reason: 'Independent face observations disagree with the editable mesh. Try a clearer or less profile-oriented face.',
      diagnostics: { yaw, insideRatio, observationAgreement }
    };
  }

  const coverage = Math.sqrt((width / imageWidth) * (height / imageHeight));
  const coverageScore = clamp01((coverage - 0.025) / 0.175);
  const observationScore = clamp01((insideRatio - 0.55) / 0.4);
  const poseScore = clamp01(1 - Math.max(0, yaw - 35) / 37);
  const confidence = Math.round(
    (0.3 + coverageScore * 0.25 + observationScore * 0.3 + poseScore * 0.15) * 1000
  ) / 1000;
  const point = (index: number) => surface[index]!;
  const leftEyeX = (point(33).x + point(133).x) * 0.5;
  const rightEyeX = (point(263).x + point(362).x) * 0.5;
  const noseX = point(1).x;
  const eyeSpan = Math.max(1e-6, Math.abs(rightEyeX - leftEyeX));
  const noseEyeAsymmetry = Math.abs((noseX - leftEyeX) - (rightEyeX - noseX)) / eyeSpan;
  return {
    accepted: true,
    confidence,
    diagnostics: {
      yaw, insideRatio, noseEyeAsymmetry,
      ...(observationAgreement === null ? {} : { observationAgreement })
    }
  };
};
