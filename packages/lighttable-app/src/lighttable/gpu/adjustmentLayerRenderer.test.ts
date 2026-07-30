import { describe, expect, it } from 'vitest';
import { createAdjustmentLayer } from '../editor/document/documentTypes';
import { createAdjustmentStackFromBasicAdjustments } from '../processing/adjustmentStack';
import { createDefaultAdjustments } from '../types';
import {
  adjustmentsRequireSpatialInput,
  createAdjustmentLayerRenderPlan
} from './adjustmentLayerRenderer';

describe('Adjustment Layer render planning', () => {
  it('skips spatial input for a neutral grade', () => {
    const layer = createAdjustmentLayer(
      createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments()),
      'Neutral'
    );

    expect(createAdjustmentLayerRenderPlan(layer).requiresSpatialInput).toBe(false);
  });

  it('requests spatial input for active clarity or dehaze', () => {
    expect(adjustmentsRequireSpatialInput({ clarity: 0.01, dehaze: 0 })).toBe(true);
    expect(adjustmentsRequireSpatialInput({ clarity: 0, dehaze: -0.01 })).toBe(true);
    expect(adjustmentsRequireSpatialInput({ clarity: 0.000001, dehaze: 0 })).toBe(false);
  });
});
