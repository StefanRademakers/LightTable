import { describe, expect, it } from 'vitest';
import { createDefaultAdjustments } from '../../types';
import {
  applyGroupVisibility,
  createDefaultGroupVisibility
} from './groupVisibility';

describe('adjustment group visibility', () => {
  it('is an exact no-op when all groups are visible', () => {
    const adjustments = createDefaultAdjustments();
    adjustments.exposureEV = 1.25;
    adjustments.colorMixer.hue[2] = 18;

    expect(
      applyGroupVisibility(adjustments, createDefaultGroupVisibility())
    ).toEqual(adjustments);
  });

  it('bypasses only the hidden processing groups', () => {
    const adjustments = createDefaultAdjustments();
    adjustments.exposureEV = 1.25;
    adjustments.temperature = 42;
    adjustments.texture = 35;
    adjustments.colorMixer.saturation[4] = 60;

    const result = applyGroupVisibility(adjustments, {
      ...createDefaultGroupVisibility(),
      light: false,
      colorMixer: false
    });

    expect(result.exposureEV).toBe(0);
    expect(result.temperature).toBe(42);
    expect(result.texture).toBe(35);
    expect(result.colorMixer.saturation).toEqual(new Array(8).fill(0));
  });

  it('does not mutate the canonical adjustment object', () => {
    const adjustments = createDefaultAdjustments();
    adjustments.shadows = 50;

    applyGroupVisibility(adjustments, {
      ...createDefaultGroupVisibility(),
      light: false
    });

    expect(adjustments.shadows).toBe(50);
  });

  it('bypasses Global Grade without disabling Global Lens FX', () => {
    const adjustments = createDefaultAdjustments();
    adjustments.exposureEV = 2;
    adjustments.effects.lensDistortion.enabled = true;
    adjustments.effects.lensDistortion.amount = 45;

    const result = applyGroupVisibility(adjustments, {
      ...createDefaultGroupVisibility(),
      globalGrade: false
    });

    expect(result.exposureEV).toBe(0);
    expect(result.effects.lensDistortion.enabled).toBe(true);
    expect(result.effects.lensDistortion.amount).toBe(45);
  });

  it('bypasses Global Lens FX without resetting Global Grade', () => {
    const adjustments = createDefaultAdjustments();
    adjustments.exposureEV = 2;
    adjustments.effects.lensDistortion.enabled = true;

    const result = applyGroupVisibility(adjustments, {
      ...createDefaultGroupVisibility(),
      globalLensFx: false
    });

    expect(result.exposureEV).toBe(2);
    expect(result.effects.lensDistortion.enabled).toBe(false);
  });
});
