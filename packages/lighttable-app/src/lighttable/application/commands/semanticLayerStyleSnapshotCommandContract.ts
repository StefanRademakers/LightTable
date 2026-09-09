import {
  parseCompleteLayerStyleSnapshot,
  type LayerStyleSnapshot
} from '../styles/completeLayerStyleSnapshot';

export interface SemanticLayerStyleSnapshotCommand {
  readonly layerId: string;
  readonly snapshot: LayerStyleSnapshot;
}

const record = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

/** Parses one complete, exact and transport-safe Layer Style stack. */
export const parseSemanticLayerStyleSnapshotCommand = (
  value: unknown
): SemanticLayerStyleSnapshotCommand | { readonly message: string } => {
  if (!record(value) || Object.keys(value).length !== 2
    || !Object.hasOwn(value, 'layerId') || !Object.hasOwn(value, 'snapshot')
    || typeof value.layerId !== 'string' || value.layerId.length < 1
    || value.layerId.length > 255) {
    return { message: 'Layer Style snapshot requires exactly layerId and snapshot.' };
  }
  const snapshot = parseCompleteLayerStyleSnapshot(value.snapshot);
  return snapshot
    ? { layerId: value.layerId, snapshot }
    : { message: 'Layer Style snapshot must contain one complete valid style stack.' };
};
