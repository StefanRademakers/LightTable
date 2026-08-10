import type { WarpStroke } from '../warp/warpTypes';
import type {
  FaceWarpFace,
  FaceWarpLandmarks,
  FaceWarpParameters,
  FaceWarpPoint
} from './faceWarpTypes';

const clampUnit = (value: number): number => Math.max(-1, Math.min(1, value));
const distance = (a: FaceWarpPoint, b: FaceWarpPoint): number => Math.hypot(a.x - b.x, a.y - b.y);

interface SemanticPush {
  readonly key: string;
  readonly point: FaceWarpPoint;
  readonly delta: readonly [number, number];
  readonly diameter: number;
}

const push = (
  key: string,
  point: FaceWarpPoint,
  dx: number,
  dy: number,
  diameter: number
): SemanticPush | null => Math.hypot(dx, dy) < 0.0001
  ? null
  : { key, point, delta: [dx, dy], diameter: Math.max(2, diameter) };

const semanticPushes = (
  landmarks: FaceWarpLandmarks,
  parameters: FaceWarpParameters
): SemanticPush[] => {
  const faceWidth = Math.max(2, distance(landmarks.leftCheek, landmarks.rightCheek));
  const faceHeight = Math.max(2, distance(landmarks.faceTop, landmarks.chin));
  const eyeDistance = Math.max(2, distance(landmarks.leftEye, landmarks.rightEye));
  const noseWidth = Math.max(2, distance(landmarks.noseLeft, landmarks.noseRight));
  const mouthWidth = Math.max(2, distance(landmarks.mouthLeft, landmarks.mouthRight));
  const eyeRadius = Math.max(faceWidth * 0.12, eyeDistance * 0.16);
  const result: Array<SemanticPush | null> = [];
  const horizontalPair = (
    key: string,
    left: FaceWarpPoint,
    right: FaceWarpPoint,
    amount: number,
    scale: number,
    diameter: number
  ) => {
    const delta = clampUnit(amount) * scale;
    result.push(
      push(`${key}-left`, left, -delta, 0, diameter),
      push(`${key}-right`, right, delta, 0, diameter)
    );
  };
  const verticalPair = (
    key: string,
    top: FaceWarpPoint,
    bottom: FaceWarpPoint,
    amount: number,
    scale: number,
    diameter: number
  ) => {
    const delta = clampUnit(amount) * scale;
    result.push(
      push(`${key}-top`, top, 0, -delta, diameter),
      push(`${key}-bottom`, bottom, 0, delta, diameter)
    );
  };

  horizontalPair('face-width', landmarks.leftCheek, landmarks.rightCheek,
    parameters.faceWidth, faceWidth * 0.12, faceHeight * 0.42);
  result.push(push('forehead', landmarks.faceTop, 0,
    -clampUnit(parameters.foreheadHeight) * faceHeight * 0.12, faceWidth * 0.55));
  result.push(push('jaw', landmarks.chin, 0,
    clampUnit(parameters.jaw) * faceHeight * 0.1, faceWidth * 0.55));

  horizontalPair('eye-spacing', landmarks.leftEye, landmarks.rightEye,
    parameters.eyeSpacing, eyeDistance * 0.1, eyeRadius * 2.4);
  horizontalPair('eye-width-left',
    { x: landmarks.leftEye.x - eyeRadius, y: landmarks.leftEye.y },
    { x: landmarks.leftEye.x + eyeRadius, y: landmarks.leftEye.y },
    parameters.eyeWidth + parameters.eyeSize, eyeRadius * 0.18, eyeRadius * 1.8);
  horizontalPair('eye-width-right',
    { x: landmarks.rightEye.x - eyeRadius, y: landmarks.rightEye.y },
    { x: landmarks.rightEye.x + eyeRadius, y: landmarks.rightEye.y },
    parameters.eyeWidth + parameters.eyeSize, eyeRadius * 0.18, eyeRadius * 1.8);
  verticalPair('eye-height-left',
    { x: landmarks.leftEye.x, y: landmarks.leftEye.y - eyeRadius * 0.65 },
    { x: landmarks.leftEye.x, y: landmarks.leftEye.y + eyeRadius * 0.65 },
    parameters.eyeHeight + parameters.eyeSize, eyeRadius * 0.16, eyeRadius * 1.8);
  verticalPair('eye-height-right',
    { x: landmarks.rightEye.x, y: landmarks.rightEye.y - eyeRadius * 0.65 },
    { x: landmarks.rightEye.x, y: landmarks.rightEye.y + eyeRadius * 0.65 },
    parameters.eyeHeight + parameters.eyeSize, eyeRadius * 0.16, eyeRadius * 1.8);
  const tilt = clampUnit(parameters.eyeTilt) * eyeRadius * 0.14;
  result.push(
    push('eye-tilt-left', landmarks.leftEye, 0, -tilt, eyeRadius * 2.2),
    push('eye-tilt-right', landmarks.rightEye, 0, tilt, eyeRadius * 2.2)
  );

  horizontalPair('nose-width', landmarks.noseLeft, landmarks.noseRight,
    parameters.noseWidth, noseWidth * 0.22, faceWidth * 0.24);
  result.push(push('nose-height', landmarks.noseTip, 0,
    clampUnit(parameters.noseHeight) * distance(landmarks.noseTop, landmarks.noseTip) * 0.2,
    faceWidth * 0.25));

  horizontalPair('mouth-width', landmarks.mouthLeft, landmarks.mouthRight,
    parameters.mouthWidth, mouthWidth * 0.2, faceWidth * 0.28);
  verticalPair('mouth-height', landmarks.mouthTop, landmarks.mouthBottom,
    parameters.mouthHeight, faceHeight * 0.018, faceWidth * 0.25);
  const smile = clampUnit(parameters.smile) * faceHeight * 0.035;
  result.push(
    push('smile-left', landmarks.mouthLeft, 0, -smile, faceWidth * 0.24),
    push('smile-right', landmarks.mouthRight, 0, -smile, faceWidth * 0.24),
    push('upper-lip', landmarks.mouthTop, 0,
      -clampUnit(parameters.upperLip) * faceHeight * 0.018, faceWidth * 0.22),
    push('lower-lip', landmarks.mouthBottom, 0,
      clampUnit(parameters.lowerLip) * faceHeight * 0.018, faceWidth * 0.22)
  );
  return result.filter((entry): entry is SemanticPush => entry !== null);
};

/**
 * Compiles semantic face edits into the existing GPU deformation primitive.
 * Generated strokes are runtime data only and never become the saved authoring
 * model of an `lt.face-warp` node.
 */
export const compileFaceWarpStrokes = (faces: readonly FaceWarpFace[]): WarpStroke[] =>
  faces.flatMap((face) => semanticPushes(face.landmarks, face.parameters).map((entry) => ({
    id: `face:${face.id}:${entry.key}`,
    mode: 'push' as const,
    settings: {
      diameterPx: entry.diameter,
      strength: 1,
      hardness: 0.35,
      flow: 1,
      spacing: 1,
      smooth: 1,
      pressureSize: false,
      pressureStrength: false
    },
    samples: [{
      positionPx: [entry.point.x, entry.point.y] as const,
      deltaPx: entry.delta,
      pressure: 1,
      tilt: [0, 0] as const,
      timeMs: 0
    }],
    startedAtMs: 0,
    durationMs: 0
  })));

