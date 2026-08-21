import type { DetailAdjustments } from '../../detail';
import {
  parseBasicAdjustmentTarget,
  type BasicAdjustmentTarget
} from './semanticBasicAdjustmentCommandContract';

export type DetailAdjustmentKey = keyof DetailAdjustments;

export const DETAIL_ADJUSTMENT_RANGES: Readonly<Record<
  DetailAdjustmentKey,
  { readonly min: number; readonly max: number }
>> = Object.freeze({
  sharpeningAmount: { min: 0, max: 150 },
  sharpeningRadius: { min: 0.5, max: 3 },
  sharpeningDetail: { min: 0, max: 100 },
  sharpeningMasking: { min: 0, max: 100 },
  luminanceNoiseReduction: { min: 0, max: 100 },
  luminanceDetail: { min: 0, max: 100 },
  luminanceContrast: { min: 0, max: 100 },
  colorNoiseReduction: { min: 0, max: 100 },
  colorDetail: { min: 0, max: 100 },
  colorSmoothness: { min: 0, max: 100 }
});

export interface SemanticDetailAdjustmentCommand {
  readonly target: BasicAdjustmentTarget;
  readonly values: Partial<Record<DetailAdjustmentKey, number>>;
}

const record = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const keys = Object.keys(DETAIL_ADJUSTMENT_RANGES) as DetailAdjustmentKey[];
const keySet = new Set<string>(keys);

export const parseSemanticDetailAdjustmentCommand = (
  value: unknown
): SemanticDetailAdjustmentCommand | { readonly message: string } => {
  if (!record(value) || !record(value.target) || !record(value.values)) {
    return { message: 'Detail requires an explicit target and numeric values.' };
  }
  if (Object.keys(value).some((key) => key !== 'target' && key !== 'values')) {
    return { message: 'Detail contains unsupported top-level properties.' };
  }
  const target = parseBasicAdjustmentTarget(value.target);
  if ('message' in target) return target;
  const valueKeys = Object.keys(value.values);
  if (valueKeys.length < 1 || valueKeys.length > keys.length
    || valueKeys.some((key) => !keySet.has(key))) {
    return { message: 'Detail values must contain one or more supported controls.' };
  }
  const values: Partial<Record<DetailAdjustmentKey, number>> = {};
  for (const key of valueKeys as DetailAdjustmentKey[]) {
    const next = value.values[key];
    const range = DETAIL_ADJUSTMENT_RANGES[key];
    if (typeof next !== 'number' || !Number.isFinite(next)
      || next < range.min || next > range.max) {
      return { message: `${key} must be a finite value from ${range.min} to ${range.max}.` };
    }
    values[key] = next;
  }
  return { target, values };
};

export const changedDetailAdjustmentValues = (
  before: DetailAdjustments,
  after: DetailAdjustments
): Partial<Record<DetailAdjustmentKey, number>> => Object.fromEntries(
  keys.filter((key) => before[key] !== after[key]).map((key) => [key, after[key]])
);
