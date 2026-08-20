import type { LayerId } from '../../editor/document/documentTypes';
import {
  BASIC_ADJUSTMENT_RANGES,
  type NumericAdjustmentKey
} from '../adjustments/groupVisibility';

export type BasicAdjustmentTarget =
  | { readonly kind: 'document' }
  | { readonly kind: 'layer'; readonly layerId: LayerId };

export interface SemanticBasicAdjustmentCommand {
  readonly target: BasicAdjustmentTarget;
  readonly values: Partial<Record<NumericAdjustmentKey, number>>;
}

const record = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const keys = Object.keys(BASIC_ADJUSTMENT_RANGES) as NumericAdjustmentKey[];
const keySet = new Set<string>(keys);

export const parseSemanticBasicAdjustmentCommand = (
  value: unknown
): SemanticBasicAdjustmentCommand | { readonly message: string } => {
  if (!record(value) || !record(value.target) || !record(value.values)) {
    return { message: 'Basic Grade requires an explicit target and numeric values.' };
  }
  if (Object.keys(value).some((key) => key !== 'target' && key !== 'values')) {
    return { message: 'Basic Grade contains unsupported top-level properties.' };
  }
  let target: BasicAdjustmentTarget;
  if (value.target.kind === 'document' && Object.keys(value.target).length === 1) {
    target = { kind: 'document' };
  } else if (value.target.kind === 'layer' && typeof value.target.layerId === 'string'
    && value.target.layerId.length > 0 && value.target.layerId.length <= 512
    && Object.keys(value.target).every((key) => key === 'kind' || key === 'layerId')) {
    target = { kind: 'layer', layerId: value.target.layerId as LayerId };
  } else {
    return { message: 'Basic Grade target must be document or one stable layerId.' };
  }
  const valueKeys = Object.keys(value.values);
  if (valueKeys.length < 1 || valueKeys.length > keys.length
    || valueKeys.some((key) => !keySet.has(key))) {
    return { message: 'Basic Grade values must contain one or more supported controls.' };
  }
  const values: Partial<Record<NumericAdjustmentKey, number>> = {};
  for (const key of valueKeys as NumericAdjustmentKey[]) {
    const next = value.values[key];
    const range = BASIC_ADJUSTMENT_RANGES[key];
    if (typeof next !== 'number' || !Number.isFinite(next)
      || next < range.min || next > range.max) {
      return { message: `${key} must be a finite value from ${range.min} to ${range.max}.` };
    }
    values[key] = next;
  }
  return { target, values };
};

export const changedBasicAdjustmentValues = (
  before: Readonly<Record<NumericAdjustmentKey, number>>,
  after: Readonly<Record<NumericAdjustmentKey, number>>
): Partial<Record<NumericAdjustmentKey, number>> => Object.fromEntries(
  keys.filter((key) => before[key] !== after[key]).map((key) => [key, after[key]])
);

