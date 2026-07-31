import { describe, expect, it } from 'vitest';
import { createDefaultAdjustments } from '../types';
import {
  createAdjustmentStackFromBasicAdjustments,
  type AdjustmentStack
} from './adjustmentStack';
import { evaluateAdjustmentStack } from './adjustmentEvaluator';

describe('evaluateAdjustmentStack', () => {
  it('preserves serialized module order', () => {
    const stack = createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments());
    stack.modules.reverse();
    const evaluation = evaluateAdjustmentStack(stack);

    expect(evaluation.steps[0]?.definition.type).toBe('lt.grain');
    expect(evaluation.steps.at(-1)?.definition.type).toBe('lt.white-balance');
  });

  it('bypasses disabled modules while retaining in-scope layer Lens Fx', () => {
    const settings = createDefaultAdjustments();
    settings.exposureEV = 2;
    settings.effects.grain.enabled = true;
    settings.effects.grain.amount = 3;
    const stack = createAdjustmentStackFromBasicAdjustments(settings);
    const light = stack.modules.find(({ type }) => type === 'lt.light');
    if (light) light.enabled = false;

    const evaluation = evaluateAdjustmentStack(stack, { scope: 'layer' });
    expect(evaluation.steps.some(({ definition }) => definition.type === 'lt.light')).toBe(false);
    expect(evaluation.steps.some(({ definition }) => definition.type === 'lt.grain')).toBe(true);
    expect(evaluation.adjustments.exposureEV).toBe(0);
    expect(evaluation.adjustments.effects.grain.enabled).toBe(true);
  });

  it('ignores unknown serialized modules', () => {
    const stack: AdjustmentStack = {
      id: 'stack',
      revision: 0,
      modules: [{
        id: 'unknown',
        type: 'plugin.not-installed',
        enabled: true,
        revision: 0,
        settings: { exposureEV: 5 }
      }]
    };
    const evaluation = evaluateAdjustmentStack(stack);
    expect(evaluation.steps).toEqual([]);
    expect(evaluation.adjustments.exposureEV).toBe(0);
  });
});
