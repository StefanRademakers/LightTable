import type { AdjustmentModuleInstance, AdjustmentStack } from '../../processing/adjustmentStack';

export const FACE_WARP_NODE_TYPE = 'lt.face-warp';

export interface FaceWarpPoint {
  readonly x: number;
  readonly y: number;
}

export interface FaceWarpLandmarks {
  readonly faceTop: FaceWarpPoint;
  readonly chin: FaceWarpPoint;
  readonly leftCheek: FaceWarpPoint;
  readonly rightCheek: FaceWarpPoint;
  readonly leftEye: FaceWarpPoint;
  readonly rightEye: FaceWarpPoint;
  readonly noseTop: FaceWarpPoint;
  readonly noseTip: FaceWarpPoint;
  readonly noseLeft: FaceWarpPoint;
  readonly noseRight: FaceWarpPoint;
  readonly mouthLeft: FaceWarpPoint;
  readonly mouthRight: FaceWarpPoint;
  readonly mouthTop: FaceWarpPoint;
  readonly mouthBottom: FaceWarpPoint;
}

export interface FaceWarpParameters {
  readonly faceWidth: number;
  readonly foreheadHeight: number;
  readonly jaw: number;
  readonly eyeSize: number;
  readonly eyeWidth: number;
  readonly eyeHeight: number;
  readonly eyeTilt: number;
  readonly eyeSpacing: number;
  readonly noseWidth: number;
  readonly noseHeight: number;
  readonly smile: number;
  readonly mouthWidth: number;
  readonly mouthHeight: number;
  readonly upperLip: number;
  readonly lowerLip: number;
}

export interface FaceWarpFace {
  readonly id: string;
  /** Layer-source pixel coordinates, frozen at detection time. */
  readonly landmarks: FaceWarpLandmarks;
  readonly parameters: FaceWarpParameters;
}

export interface FaceWarpNodeSettings {
  readonly version: 1;
  readonly opacity: number;
  readonly sourceRevision: number;
  readonly detector: {
    readonly id: string;
    readonly version: string;
  };
  readonly faces: readonly FaceWarpFace[];
}

export const createDefaultFaceWarpParameters = (): FaceWarpParameters => ({
  faceWidth: 0,
  foreheadHeight: 0,
  jaw: 0,
  eyeSize: 0,
  eyeWidth: 0,
  eyeHeight: 0,
  eyeTilt: 0,
  eyeSpacing: 0,
  noseWidth: 0,
  noseHeight: 0,
  smile: 0,
  mouthWidth: 0,
  mouthHeight: 0,
  upperLip: 0,
  lowerLip: 0
});

export const createFaceWarpModuleInstance = (
  id: string,
  settings: FaceWarpNodeSettings
): AdjustmentModuleInstance => ({
  id,
  type: FACE_WARP_NODE_TYPE,
  enabled: true,
  revision: 0,
  settings: structuredClone(settings) as unknown as Record<string, unknown>
});

export const findFaceWarpModuleInstance = (
  stack: AdjustmentStack | null | undefined
): AdjustmentModuleInstance | null =>
  stack?.modules.find((instance) => instance.type === FACE_WARP_NODE_TYPE) ?? null;

export const readFaceWarpNodeSettings = (
  instance: AdjustmentModuleInstance
): FaceWarpNodeSettings => {
  if (instance.type !== FACE_WARP_NODE_TYPE) {
    throw new Error(`Expected ${FACE_WARP_NODE_TYPE}, received ${instance.type}`);
  }
  const settings = instance.settings as unknown as Partial<FaceWarpNodeSettings>;
  if (settings.version !== 1 || !Array.isArray(settings.faces)) {
    throw new Error(`Invalid ${FACE_WARP_NODE_TYPE} settings`);
  }
  return structuredClone(settings) as FaceWarpNodeSettings;
};

