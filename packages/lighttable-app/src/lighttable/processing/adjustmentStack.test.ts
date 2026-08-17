import { describe, expect, it } from 'vitest';
import { createDefaultAdjustments } from '../types';
import {
  adjustmentStackForOwner,
  adjustmentStackForModuleTypes,
  adjustmentStackForScope,
  adjustmentStackHasLocalProcessing,
  adjustmentStackLocalProcessingIsEnabled,
  adjustmentStackGradeGroupIsEnabled,
  adjustmentStackOwnerIsEnabled,
  cloneAdjustmentStack,
  createAdjustmentStackFromBasicAdjustments,
  ensureAdjustmentStackLocalProcessing,
  materializeBasicAdjustments,
  removeAdjustmentStackOwner,
  removeAdjustmentStackLocalProcessing,
  setAdjustmentStackLocalProcessingEnabled,
  setAdjustmentStackGradeGroupEnabled,
  setAdjustmentStackOwnerEnabled
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
    settings.detail.sharpeningAmount = 88;
    settings.detail.colorNoiseReduction = 31;
    settings.curves.master = [{ x: 0, y: 0 }, { x: 0.4, y: 0.52 }, { x: 1, y: 1 }];
    settings.gradientMap = {
      enabled: true,
      reverse: true,
      dither: true,
      colorStops: [
        { position: 0, midpoint: 0.4, color: { r: 0.1, g: 0.2, b: 0.3 } },
        { position: 1, midpoint: 0.6, color: { r: 0.9, g: 0.8, b: 0.7 } }
      ],
      opacityStops: [
        { position: 0, midpoint: 0.5, opacity: 0.25 },
        { position: 1, midpoint: 0.5, opacity: 1 }
      ]
    };
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

  it('bypasses one Grade section without losing values or re-enabling on edit', () => {
    const settings = createDefaultAdjustments();
    settings.colorGrading.hue[0] = 0.72;
    const stack = createAdjustmentStackFromBasicAdjustments(settings, undefined, sequentialIds());
    const bypassed = setAdjustmentStackGradeGroupEnabled(stack, 'colorGrading', false);

    expect(adjustmentStackGradeGroupIsEnabled(bypassed, 'colorGrading')).toBe(false);
    expect(materializeBasicAdjustments(bypassed).colorGrading.hue[0]).toBe(0);
    expect(materializeBasicAdjustments(bypassed, undefined, undefined, true)
      .colorGrading.hue[0]).toBe(0.72);

    const edited = createDefaultAdjustments();
    edited.colorGrading.hue[0] = 0.4;
    const updated = createAdjustmentStackFromBasicAdjustments(edited, bypassed, sequentialIds());
    expect(adjustmentStackGradeGroupIsEnabled(updated, 'colorGrading')).toBe(false);
    expect(materializeBasicAdjustments(updated, undefined, undefined, true)
      .colorGrading.hue[0]).toBe(0.4);
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

  it('supports Lens Fx as the same ordered stack shape on Adjustment Layers', () => {
    const settings = createDefaultAdjustments();
    settings.exposureEV = 1.5;
    settings.effects.grain.enabled = true;
    settings.effects.halation.enabled = true;
    const stack = adjustmentStackForScope(
      createAdjustmentStackFromBasicAdjustments(settings, undefined, sequentialIds()),
      'adjustment-layer'
    );

    expect(stack.modules.some((module) => module.type === 'lt.light')).toBe(true);
    expect(stack.modules.some((module) => module.type === 'lt.grain')).toBe(true);
    expect(stack.modules.some((module) => module.type === 'lt.halation')).toBe(true);
    expect(materializeBasicAdjustments(stack).exposureEV).toBe(1.5);
  });

  it('keeps Grade and Lens Fx ownership and bypass independent', () => {
    const settings = createDefaultAdjustments();
    settings.exposureEV = 1.5;
    settings.effects.lensDistortion.enabled = true;
    const full = adjustmentStackForScope(
      createAdjustmentStackFromBasicAdjustments(settings, undefined, sequentialIds()),
      'layer'
    );
    const grade = adjustmentStackForOwner(full, 'grade');
    const lens = adjustmentStackForOwner(full, 'lens-fx');

    expect(grade.modules.some((module) => module.type === 'lt.light')).toBe(true);
    expect(grade.modules.some((module) => module.type === 'lt.lens-distortion')).toBe(false);
    expect(lens.modules.some((module) => module.type === 'lt.light')).toBe(false);
    expect(lens.modules.some((module) => module.type === 'lt.lens-distortion')).toBe(true);

    const lensBypassed = setAdjustmentStackOwnerEnabled(full, 'lens-fx', false);
    expect(adjustmentStackOwnerIsEnabled(lensBypassed, 'grade')).toBe(true);
    expect(adjustmentStackOwnerIsEnabled(lensBypassed, 'lens-fx')).toBe(false);
    expect(materializeBasicAdjustments(lensBypassed).exposureEV).toBe(1.5);
    expect(materializeBasicAdjustments(lensBypassed).effects.lensDistortion.enabled).toBe(false);
  });

  it('extracts the exact module inventory for a specialized adjustment node', () => {
    const stack = createAdjustmentStackFromBasicAdjustments(
      createDefaultAdjustments(), undefined, sequentialIds()
    );

    const curves = adjustmentStackForModuleTypes(stack, ['lt.curves']);

    expect(curves.modules.map((module) => module.type)).toEqual(['lt.curves']);
    expect(curves.id).toBe(stack.id);
  });

  it('keeps local Grade and Curves independently addressable', () => {
    const curves = ensureAdjustmentStackLocalProcessing(null, 'curves');
    expect(curves.modules.map((module) => module.type)).toEqual(['lt.curves']);
    expect(adjustmentStackHasLocalProcessing(curves, 'curves')).toBe(true);
    expect(adjustmentStackHasLocalProcessing(curves, 'grade')).toBe(false);

    const withGrade = ensureAdjustmentStackLocalProcessing(curves, 'grade');
    expect(adjustmentStackHasLocalProcessing(withGrade, 'grade')).toBe(true);
    expect(adjustmentStackHasLocalProcessing(withGrade, 'curves')).toBe(true);

    const curvesBypassed = setAdjustmentStackLocalProcessingEnabled(withGrade, 'curves', false);
    expect(adjustmentStackLocalProcessingIsEnabled(curvesBypassed, 'curves')).toBe(false);
    expect(adjustmentStackLocalProcessingIsEnabled(curvesBypassed, 'grade')).toBe(true);

    const withoutGrade = removeAdjustmentStackLocalProcessing(curvesBypassed, 'grade');
    expect(withoutGrade.modules.map((module) => module.type)).toEqual(['lt.curves']);
  });

  it('removes one local owner without deleting unrelated processing modules', () => {
    const settings = createDefaultAdjustments();
    settings.exposureEV = 1.5;
    settings.effects.lensBlur.enabled = true;
    const full = adjustmentStackForScope(
      createAdjustmentStackFromBasicAdjustments(settings, undefined, sequentialIds()),
      'layer'
    );

    const withoutGrade = removeAdjustmentStackOwner(full, 'grade');

    expect(adjustmentStackForOwner(withoutGrade, 'grade').modules).toHaveLength(0);
    expect(adjustmentStackForOwner(withoutGrade, 'lens-fx').modules.length).toBeGreaterThan(0);
    expect(withoutGrade.revision).toBe(full.revision + 1);
  });
});
