import { MEDIAPIPE_FACE_VERTEX_COUNT } from './canonicalFaceTopology';
import type { FaceWarpPoint } from './faceWarpTypes';
import { facePoseYawDegrees } from './faceWarpPose';

export interface FaceWarpDetectionQuality {
  readonly accepted: boolean;
  readonly confidence: number;
  readonly reason?: string;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

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
  imageHeight: number
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

  const coverage = Math.sqrt((width / imageWidth) * (height / imageHeight));
  const coverageScore = clamp01((coverage - 0.025) / 0.175);
  const observationScore = clamp01((insideRatio - 0.55) / 0.4);
  const poseScore = clamp01(1 - Math.max(0, yaw - 35) / 37);
  const confidence = Math.round(
    (0.3 + coverageScore * 0.25 + observationScore * 0.3 + poseScore * 0.15) * 1000
  ) / 1000;
  return { accepted: true, confidence };
};
