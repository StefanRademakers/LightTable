import type { BasicAdjustments } from '../../types';
import {
  BASIC_ADJUSTMENT_RANGES,
  type NumericAdjustmentKey
} from './groupVisibility';
import type { BasicAdjustmentTarget } from '../commands/semanticBasicAdjustmentCommandContract';

export interface BasicGradeQueryResult {
  readonly target: BasicAdjustmentTarget;
  readonly documentRevision: number;
  readonly targetRevision: number;
  readonly values: Readonly<Record<NumericAdjustmentKey, number>>;
}

const keys = Object.keys(BASIC_ADJUSTMENT_RANGES) as NumericAdjustmentKey[];

export const projectBasicAdjustmentValues = (
  adjustments: BasicAdjustments
): Readonly<Record<NumericAdjustmentKey, number>> => Object.fromEntries(
  keys.map((key) => [key, adjustments[key]])
) as unknown as Readonly<Record<NumericAdjustmentKey, number>>;
