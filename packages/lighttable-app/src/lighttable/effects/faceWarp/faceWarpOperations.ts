import {
  applyFaceWarpFeatureChange,
  applyFaceWarpParameterChange
} from './faceWarpDeformer';
import type {
  FaceWarpFeatureParameters,
  FaceWarpNodeSettings,
  FaceWarpParameters
} from './faceWarpTypes';

export type FaceWarpSemanticTarget = 'both' | 'left' | 'right';

/** Stable semantic operation shared by UI, persistence automation and future MCP. */
export interface SetFaceWarpSemanticOperation {
  readonly kind: 'set-semantic';
  readonly faceId: string;
  readonly target: FaceWarpSemanticTarget;
  readonly change: Partial<FaceWarpParameters>;
}

export type FaceWarpOperation = SetFaceWarpSemanticOperation;

const SIDE_PARAMETERS = new Set<keyof FaceWarpParameters>([
  'eyeSize', 'eyeWidth', 'eyeHeight', 'eyeTilt', 'smile'
]);

export const applyFaceWarpOperation = (
  settings: FaceWarpNodeSettings,
  operation: FaceWarpOperation
): FaceWarpNodeSettings => {
  if (operation.kind !== 'set-semantic') return settings;
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
    const globallyChanged = Object.keys(globalChange).length > 0
      ? applyFaceWarpParameterChange(face, settings.topology.triangleIndices, globalChange)
      : face;
    return Object.keys(featureChange).length > 0
      ? applyFaceWarpFeatureChange(
        globallyChanged,
        settings.topology.triangleIndices,
        operation.target,
        featureChange
      )
      : globallyChanged;
  });
  return found ? { ...settings, faces } : settings;
};
