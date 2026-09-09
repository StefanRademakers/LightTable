import type { BasicAdjustments } from '../../types';
import { parseCompleteAdjustmentSnapshot } from '../adjustments/completeAdjustmentSnapshot';
import {
  parseAdjustmentQueryTarget,
  type AdjustmentQueryTarget
} from '../adjustments/adjustmentQuery';

export interface SemanticAdjustmentSnapshotCommand {
  readonly target: AdjustmentQueryTarget;
  readonly snapshot: BasicAdjustments;
}

const record = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

/**
 * Parses a complete, transport-safe adjustment snapshot.
 *
 * Partial or unknown shapes are rejected: command replay must restore the
 * exact authored processing state, not silently fill or discard fields.
 */
export const parseSemanticAdjustmentSnapshotCommand = (
  value: unknown
): SemanticAdjustmentSnapshotCommand | { readonly message: string } => {
  if (!record(value) || !record(value.target) || !record(value.snapshot)
    || Object.keys(value).some((key) => key !== 'target' && key !== 'snapshot')) {
    return { message: 'Adjustment snapshot requires exactly target and snapshot.' };
  }
  const target = parseAdjustmentQueryTarget(value.target);
  if ('message' in target) return target;
  const snapshot = parseCompleteAdjustmentSnapshot(value.snapshot);
  if (!snapshot) {
    return { message: 'Adjustment snapshot must contain one complete valid processing state.' };
  }
  return { target, snapshot };
};
