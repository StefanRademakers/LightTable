import type { AdjustmentModuleInstance, AdjustmentStack } from '../../processing/adjustmentStack';
import { MEDIAPIPE_FACE_VERTEX_COUNT } from './canonicalFaceTopology';

export const FACE_WARP_NODE_TYPE = 'lt.face-warp';

export interface FaceWarpPoint {
  readonly x: number;
  readonly y: number;
  /** Camera-relative detector depth in source-pixel units; smaller is nearer. */
  readonly z?: number;
}

export interface FaceWarpLandmarks {
  /** Complete detector mesh in layer-source pixels; this is the authored control lattice. */
  readonly mesh: readonly FaceWarpPoint[];
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
  readonly confidence: number;
  /** Layer-source pixel coordinates, frozen at detection time. */
  readonly landmarks: FaceWarpLandmarks;
  readonly parameters: FaceWarpParameters;
  /** One canonical source-local displacement per surface vertex. */
  readonly displacements?: readonly FaceWarpPoint[];
  /** Detector face-local pose, row-major 4 x 4 when available. */
  readonly poseMatrix?: readonly number[];
}

export interface FaceWarpNodeSettings {
  readonly version: 2;
  readonly opacity: number;
  readonly sourceRevision: number;
  readonly detector: {
    readonly id: string;
    readonly version: string;
  };
  /** Fixed, self-contained detector geometry; rendering never loads ML code. */
  readonly topology: {
    readonly id: string;
    readonly vertexCount: number;
    readonly triangleIndices: readonly number[];
    readonly canonicalPositions: readonly number[];
    readonly canonicalUvs: readonly number[];
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

export const addFaceWarpNodeToStack = (
  stack: AdjustmentStack,
  instance: AdjustmentModuleInstance
): AdjustmentStack => ({
  ...structuredClone(stack),
  revision: stack.revision + 1,
  modules: [structuredClone(instance), ...stack.modules.map((module) => structuredClone(module))]
});

export const setFaceWarpNodeSettings = (
  stack: AdjustmentStack,
  settings: FaceWarpNodeSettings
): AdjustmentStack => {
  let found = false;
  const modules = stack.modules.map((module) => {
    if (module.type !== FACE_WARP_NODE_TYPE) return structuredClone(module);
    found = true;
    return {
      ...structuredClone(module),
      revision: module.revision + 1,
      settings: structuredClone(settings) as unknown as Record<string, unknown>
    };
  });
  if (!found) return stack;
  return { ...structuredClone(stack), revision: stack.revision + 1, modules };
};

export const removeFaceWarpNodeFromStack = (stack: AdjustmentStack): AdjustmentStack => {
  const modules = stack.modules.filter((module) => module.type !== FACE_WARP_NODE_TYPE);
  if (modules.length === stack.modules.length) return stack;
  return { ...structuredClone(stack), revision: stack.revision + 1, modules };
};

export const readFaceWarpNodeSettings = (
  instance: AdjustmentModuleInstance
): FaceWarpNodeSettings => {
  if (instance.type !== FACE_WARP_NODE_TYPE) {
    throw new Error(`Expected ${FACE_WARP_NODE_TYPE}, received ${instance.type}`);
  }
  const settings = instance.settings as unknown as Partial<FaceWarpNodeSettings>;
  if (settings.version !== 2
    || !Array.isArray(settings.faces)
    || typeof settings.topology !== 'object'
    || settings.topology === null
    || !Array.isArray(settings.topology.triangleIndices)
    || !Array.isArray(settings.topology.canonicalPositions)
    || !Array.isArray(settings.topology.canonicalUvs)
    || settings.topology.vertexCount !== MEDIAPIPE_FACE_VERTEX_COUNT
    || settings.topology.canonicalPositions.length !== settings.topology.vertexCount * 3
    || settings.topology.canonicalUvs.length !== settings.topology.vertexCount * 2
    || settings.topology.triangleIndices.length % 3 !== 0
    || settings.faces.some((face: FaceWarpFace) => face.landmarks.mesh.length !== settings.topology!.vertexCount
      || (Object.values(face.parameters) as number[])
        .some((value) => !Number.isFinite(value) || value < -1 || value > 1)
      || face.landmarks.mesh.some((point: FaceWarpPoint) => !Number.isFinite(point.x)
        || !Number.isFinite(point.y)
        || (point.z !== undefined && !Number.isFinite(point.z)))
      || (face.poseMatrix !== undefined && (face.poseMatrix.length !== 16
        || face.poseMatrix.some((value: number) => !Number.isFinite(value)))))) {
    throw new Error(`Invalid ${FACE_WARP_NODE_TYPE} settings`);
  }
  return structuredClone(settings) as FaceWarpNodeSettings;
};
