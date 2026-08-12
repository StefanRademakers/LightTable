import type { FaceWarpOperation } from '../../effects/faceWarp/faceWarpOperations';
import type { FaceWarpParameters, FaceWarpProtectedFeature } from '../../effects/faceWarp/faceWarpTypes';

export interface SemanticFaceWarpCommand {
  readonly layerId: string;
  readonly operation: FaceWarpOperation;
}

const PARAMETER_KEYS = new Set<keyof FaceWarpParameters>([
  'faceWidth', 'foreheadHeight', 'jaw', 'eyeSize', 'eyeWidth', 'eyeHeight',
  'eyeTilt', 'eyeSpacing', 'noseWidth', 'noseHeight', 'smile', 'mouthWidth',
  'mouthHeight', 'upperLip', 'lowerLip'
]);
const TARGETS = new Set(['both', 'left', 'right']);
const PROTECTED_FEATURES = new Set<FaceWarpProtectedFeature>([
  'eyes', 'lips', 'nose', 'face-outline'
]);
const record = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);
const identifier = (value: unknown): value is string => (
  typeof value === 'string' && value.length > 0 && value.length <= 255
);

/** Strict transport parser shared by local automation and the MCP adapter. */
export const parseSemanticFaceWarpCommand = (
  value: unknown
): SemanticFaceWarpCommand | { readonly message: string } => {
  if (!record(value) || !identifier(value.layerId) || !record(value.operation)
    || !identifier(value.operation.faceId)) {
    return { message: 'Face Warp commands require a valid layerId, operation and faceId.' };
  }
  const operation = value.operation;
  if (operation.kind === 'set-semantic') {
    if (!TARGETS.has(String(operation.target)) || !record(operation.change)) {
      return { message: 'Face Warp semantic commands require a valid target and change.' };
    }
    const entries = Object.entries(operation.change);
    if (entries.length < 1 || entries.some(([key, amount]) => !PARAMETER_KEYS.has(key as keyof FaceWarpParameters)
      || typeof amount !== 'number' || !Number.isFinite(amount) || amount < -1 || amount > 1)) {
      return { message: 'Face Warp semantic values must be known parameters between -1 and 1.' };
    }
  } else if (operation.kind === 'set-protection') {
    if (!PROTECTED_FEATURES.has(operation.feature as FaceWarpProtectedFeature)
      || typeof operation.locked !== 'boolean') {
      return { message: 'Face Warp protection requires a valid feature and locked state.' };
    }
  } else {
    return { message: 'The Face Warp operation kind is unsupported.' };
  }
  return structuredClone(value) as unknown as SemanticFaceWarpCommand;
};
