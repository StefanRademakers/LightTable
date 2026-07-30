import { describe, expect, it } from 'vitest';
import { createDefaultAdjustments } from '../types';
import {
  createAdjustmentStackFromBasicAdjustments,
  type AdjustmentStack
} from './adjustmentStack';
import { evaluateAdjustmentStack } from './adjustmentEvaluator';

describe('evaluateAdjustmentStack', () => {
  it('uses registry order rather than serialized module order', () => {
    const stack = createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments());
    stack.modules.reverse();
    const evaluation = evaluateAdjustmentStack(stack);

    expect(evaluation.steps[0]?.definition.type).toBe('lt.white-balance');
    expect(evaluation.steps.at(-1)?.definition.type).toBe('lt.grain');
  });

  it('bypasses disabled and out-of-scope modules exactly', () => {
    const settings = createDefaultAdjustments();
    settings.exposureEV = 2;
    settings.effects.grain.enabled = true;
    settings.effects.grain.amount = 3;
    const stack = createAdjustmentStackFromBasicAdjustments(settings);
    const light = stack.modules.find(({ type }) => type === 'lt.light');
    if (light) light.enabled = false;

    const evaluation = evaluateAdjustmentStack(stack, { scope: 'layer' });
    expect(evaluation.steps.some(({ definition }) => definition.type === 'lt.light')).toBe(false);
    expect(evaluation.steps.some(({ definition }) => definition.type === 'lt.grain')).toBe(false);
    expect(evaluation.adjustments.exposureEV).toBe(0);
    expect(evaluation.adjustments.effects.grain.enabled).toBe(false);
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
