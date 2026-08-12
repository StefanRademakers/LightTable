import {
  applyFaceWarpFeatureChange,
  applyFaceWarpParameterChange
} from './faceWarpDeformer';
import type {
  FaceWarpFeatureParameters,
  FaceWarpNodeSettings,
  FaceWarpParameters
} from './faceWarpTypes';
import type { FaceWarpProtectedFeature } from './faceWarpTypes';

export type FaceWarpSemanticTarget = 'both' | 'left' | 'right';

/** Stable semantic operation shared by UI, persistence automation and future MCP. */
export interface SetFaceWarpSemanticOperation {
  readonly kind: 'set-semantic';
  readonly faceId: string;
  readonly target: FaceWarpSemanticTarget;
  readonly change: Partial<FaceWarpParameters>;
}

export interface SetFaceWarpProtectionOperation {
  readonly kind: 'set-protection';
  readonly faceId: string;
  readonly feature: FaceWarpProtectedFeature;
  readonly locked: boolean;
}

export type FaceWarpOperation = SetFaceWarpSemanticOperation | SetFaceWarpProtectionOperation;

const SIDE_PARAMETERS = new Set<keyof FaceWarpParameters>([
  'eyeSize', 'eyeWidth', 'eyeHeight', 'eyeTilt', 'smile'
]);

export const applyFaceWarpOperation = (
  settings: FaceWarpNodeSettings,
  operation: FaceWarpOperation
): FaceWarpNodeSettings => {
  if (operation.kind === 'set-protection') {
    let found = false;
    const faces = settings.faces.map((face) => {
      if (face.id !== operation.faceId) return face;
      found = true;
      return {
        ...face,
        protection: { ...face.protection, [operation.feature]: operation.locked }
      };
    });
    return found ? { ...settings, faces } : settings;
  }
  const featureChange = Object.fromEntries(
    Object.entries(operation.change)
      .filter(([key]) => SIDE_PARAMETERS.has(key as keyof FaceWarpParameters))
  ) as Partial<FaceWarpFeatureParameters>;
  const globalChange = Object.fromEntries(
    Object.entries(operation.change)
      .filter(([key]) => !SIDE_PARAMETERS.has(key as keyof FaceWarpParameters))
  ) as Partial<FaceWarpParameters>;
  let found = false;
  const faces = settings.faces.map((face) => {
    if (face.id !== operation.faceId) return face;
    found = true;
    const blocked = new Set<keyof FaceWarpParameters>();
    if (face.protection?.eyes) {
      ['eyeSize', 'eyeWidth', 'eyeHeight', 'eyeTilt', 'eyeSpacing']
        .forEach((key) => blocked.add(key as keyof FaceWarpParameters));
    }
    if (face.protection?.lips) {
      ['smile', 'mouthWidth', 'mouthHeight', 'upperLip', 'lowerLip']
        .forEach((key) => blocked.add(key as keyof FaceWarpParameters));
    }
    if (face.protection?.nose) {
      ['noseWidth', 'noseHeight'].forEach((key) => blocked.add(key as keyof FaceWarpParameters));
    }
    if (face.protection?.['face-outline']) {
      ['faceWidth', 'foreheadHeight', 'jaw']
        .forEach((key) => blocked.add(key as keyof FaceWarpParameters));
    }
    const allowedFeatureChange = Object.fromEntries(Object.entries(featureChange)
      .filter(([key]) => !blocked.has(key as keyof FaceWarpParameters)));
    const allowedGlobalChange = Object.fromEntries(Object.entries(globalChange)
      .filter(([key]) => !blocked.has(key as keyof FaceWarpParameters)));
    const globallyChanged = Object.keys(allowedGlobalChange).length > 0
      ? applyFaceWarpParameterChange(face, settings.topology.triangleIndices, allowedGlobalChange)
      : face;
    return Object.keys(allowedFeatureChange).length > 0
      ? applyFaceWarpFeatureChange(
        globallyChanged,
        settings.topology.triangleIndices,
        operation.target,
        allowedFeatureChange
      )
      : globallyChanged;
  });
  return found ? { ...settings, faces } : settings;
};
