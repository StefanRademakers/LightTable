import { describe, expect, it } from 'vitest';
import { createDefaultAdjustments } from '../types';
import {
  adjustmentStackForScope,
  cloneAdjustmentStack,
  createAdjustmentStackFromBasicAdjustments,
  materializeBasicAdjustments
} from './adjustmentStack';

const sequentialIds = () => {
  let id = 0;
  return (kind: 'stack' | 'module') => `${kind}-${++id}`;
};

describe('LightTable adjustment stacks', () => {
  it('round-trips every current BasicAdjustments setting', () => {
    const settings = createDefaultAdjustments();
    settings.exposureEV = 1.25;
    settings.temperature = -31;
    settings.colorMixer.saturation[3] = 42;
    settings.colorGrading.hue[0] = 0.73;
    settings.curves.master = [{ x: 0, y: 0 }, { x: 0.4, y: 0.52 }, { x: 1, y: 1 }];
    settings.effects.halation.enabled = true;
    settings.effects.grain.amount = 1.55;

    const stack = createAdjustmentStackFromBasicAdjustments(settings, undefined, sequentialIds());
    expect(materializeBasicAdjustments(stack)).toEqual(settings);
  });

  it('preserves stable identities and only revises the changed module', () => {
    const createId = sequentialIds();
    const initial = createAdjustmentStackFromBasicAdjustments(
      createDefaultAdjustments(),
      undefined,
      createId
    );
    const unchanged = createAdjustmentStackFromBasicAdjustments(
      createDefaultAdjustments(),
      initial,
      createId
    );
    expect(unchanged).toEqual(initial);

    const changedSettings = createDefaultAdjustments();
    changedSettings.exposureEV = 2;
    const changed = createAdjustmentStackFromBasicAdjustments(changedSettings, unchanged, createId);
    expect(changed.id).toBe(initial.id);
    expect(changed.revision).toBe(initial.revision + 1);

    changed.modules.forEach((module, index) => {
      expect(module.id).toBe(initial.modules[index].id);
      expect(module.revision).toBe(
        module.type === 'lt.light'
          ? initial.modules[index].revision + 1
          : initial.modules[index].revision
      );
    });
  });

  it('uses defaults for disabled modules', () => {
    const settings = createDefaultAdjustments();
    settings.exposureEV = 3;
    settings.shadows = 72;
    settings.temperature = 20;
    const stack = createAdjustmentStackFromBasicAdjustments(settings, undefined, sequentialIds());
    const light = stack.modules.find((module) => module.type === 'lt.light');
    if (!light) throw new Error('Light module missing');
    light.enabled = false;

    const materialized = materializeBasicAdjustments(stack);
    expect(materialized.exposureEV).toBe(0);
    expect(materialized.shadows).toBe(0);
    expect(materialized.temperature).toBe(20);
  });

  it('is JSON serializable without changing the current grade', () => {
    const createId = sequentialIds();
    const initial = createAdjustmentStackFromBasicAdjustments(
      createDefaultAdjustments(),
      undefined,
      createId
    );
    const settings = createDefaultAdjustments();
    settings.contrast = 18;
    const updated = createAdjustmentStackFromBasicAdjustments(settings, initial, createId);
    const serialized = JSON.parse(JSON.stringify(cloneAdjustmentStack(updated)));

    expect(materializeBasicAdjustments(serialized).contrast).toBe(18);
    expect(serialized).toEqual(updated);
  });

  it('keeps document-only lens and output effects out of adjustment layers', () => {
    const settings = createDefaultAdjustments();
    settings.exposureEV = 1.5;
    settings.effects.grain.enabled = true;
    settings.effects.halation.enabled = true;
    const stack = adjustmentStackForScope(
      createAdjustmentStackFromBasicAdjustments(settings, undefined, sequentialIds()),
      'adjustment-layer'
    );

    expect(stack.modules.some((module) => module.type === 'lt.light')).toBe(true);
    expect(stack.modules.some((module) => module.type === 'lt.grain')).toBe(false);
    expect(stack.modules.some((module) => module.type === 'lt.halation')).toBe(false);
    expect(materializeBasicAdjustments(stack).exposureEV).toBe(1.5);
  });
});
