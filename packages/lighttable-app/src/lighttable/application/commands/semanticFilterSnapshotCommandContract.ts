import { parseCompleteFilterSnapshot, type FilterSnapshot }
  from '../filters/completeFilterSnapshot';
import type { FilterSnapshotTarget } from '../filters/filterSnapshotOwner';

export interface SemanticFilterSnapshotCommand {
  readonly target: FilterSnapshotTarget;
  readonly snapshot: FilterSnapshot;
}

const record = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);
const id = (value: unknown): value is string => typeof value === 'string'
  && value.length >= 1 && value.length <= 255;

const parseTarget = (value: unknown): FilterSnapshotTarget | null => {
  if (!record(value) || typeof value.kind !== 'string') return null;
  if (value.kind === 'layer' && Object.keys(value).length === 2 && id(value.layerId)) {
    return { kind: 'layer', layerId: value.layerId as FilterSnapshotTarget['layerId'] };
  }
  if (value.kind === 'attached' && Object.keys(value).length === 3
    && id(value.layerId) && id(value.adjustmentId)) {
    return {
      kind: 'attached',
      layerId: value.layerId as FilterSnapshotTarget['layerId'],
      adjustmentId: value.adjustmentId
    };
  }
  return null;
};

/** Parses one exact target and one complete typed filter value. */
export const parseSemanticFilterSnapshotCommand = (
  value: unknown
): SemanticFilterSnapshotCommand | { readonly message: string } => {
  if (!record(value) || Object.keys(value).length !== 2
    || !Object.hasOwn(value, 'target') || !Object.hasOwn(value, 'snapshot')) {
    return { message: 'Filter snapshot requires exactly target and snapshot.' };
  }
  const target = parseTarget(value.target);
  const snapshot = parseCompleteFilterSnapshot(value.snapshot);
  return target && snapshot
    ? { target, snapshot }
    : { message: 'Filter snapshot target or complete typed settings are invalid.' };
};
