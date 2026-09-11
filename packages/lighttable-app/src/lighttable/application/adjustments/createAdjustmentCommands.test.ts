import { describe, expect, it, vi } from 'vitest';
import { appendPointColorSample } from '../../pointColor';
import {
  createAdjustmentCommands,
  type AdjustmentCommandPorts
} from './createAdjustmentCommands';
import type { AdjustmentInteractionHandle } from './AdjustmentInteractionCoordinator';
import {
  createDefaultAdjustments,
  type BasicAdjustments
} from '../../types';

const createHarness = () => {
  const interactionHandle: AdjustmentInteractionHandle = {
    key: 'test-interaction',
    token: { sequence: 1 }
  };
  let adjustments = createDefaultAdjustments();
  let viewportMode: 'result' | 'depth' = 'result';
  let focusPickerActive = true;
  const endAdjustment = vi.fn();
  const publishLensBlurViewportMode = vi.fn((next: 'result' | 'depth') => {
    viewportMode = next;
  });
  const changeAdjustments = vi.fn((
    recipe: (current: BasicAdjustments) => BasicAdjustments,
    _domain?: 'grade' | 'lens-fx' | 'all',
    _interactionHandle?: AdjustmentInteractionHandle | void
  ) => {
    const next = recipe(adjustments);
    const changed = JSON.stringify(next) !== JSON.stringify(adjustments);
    adjustments = next;
    return changed;
  });
  const ports: AdjustmentCommandPorts = {
    endAdjustment,
    changeAdjustments,
    getAdjustments: () => adjustments,
    setFocusPickerActive: (active) => {
      focusPickerActive = active;
    },
    publishLensBlurViewportMode,
    getSourceName: () => 'Test image',
    publishGradeStatus: vi.fn()
  };
  return {
    commands: createAdjustmentCommands(ports),
    endAdjustment,
    changeAdjustments,
    publishLensBlurViewportMode,
    adjustments: () => adjustments,
    viewportMode: () => viewportMode,
    focusPickerActive: () => focusPickerActive,
    interactionHandle
  };
};

describe('createAdjustmentCommands', () => {
  it('coalesces scalar and effect changes through their correct transaction', () => {
    const harness = createHarness();

    harness.commands.updateAdjustment('exposureEV', 1.25, harness.interactionHandle);
    harness.commands.updateGrain('amount', 2.5, harness.interactionHandle);
    harness.commands.updateLensBlur('apertureSize', 75, harness.interactionHandle);

    expect(harness.adjustments().exposureEV).toBe(1.25);
    expect(harness.adjustments().effects.grain.amount).toBe(2.5);
    expect(harness.adjustments().effects.lensBlur.apertureSize).toBe(75);
    expect(harness.changeAdjustments.mock.calls.map((call) => call[2])).toEqual([
      harness.interactionHandle, harness.interactionHandle, harness.interactionHandle
    ]);
  });

  it('resets a group without mutating the previous adjustment snapshot', () => {
    const harness = createHarness();
    harness.commands.updateAdjustment('exposureEV', 2);
    harness.commands.updateAdjustment('contrast', 40);
    const previous = harness.adjustments();

    harness.commands.resetGroup('light');

    expect(harness.adjustments()).not.toBe(previous);
    expect(previous.exposureEV).toBe(2);
    expect(previous.contrast).toBe(40);
    expect(harness.adjustments().exposureEV).toBe(0);
    expect(harness.adjustments().contrast).toBe(0);
    expect(harness.endAdjustment).toHaveBeenCalled();
  });

  it('edits and removes an existing independent Point Color sample', () => {
    const harness = createHarness();
    harness.adjustments().pointColor = appendPointColorSample(harness.adjustments().pointColor, 'skin', 0.7, 0.12, 0.8);
    harness.commands.updatePointColorSample('skin', 'hueShift', 35, harness.interactionHandle);
    harness.commands.updatePointColorSample('skin', 'luminanceRange', 72, harness.interactionHandle);

    expect(harness.adjustments().pointColor.samples[0]).toMatchObject({
      id: 'skin', hueShift: 35, luminanceRange: 72
    });
    expect(harness.changeAdjustments.mock.calls.slice(0, 2)
      .every((call) => call[2] === harness.interactionHandle)).toBe(true);

    harness.commands.removePointColorSample('skin');
    expect(harness.adjustments().pointColor.samples).toEqual([]);
  });

  it('authors and resets the native eight-range Black & White Mix', () => {
    const harness = createHarness();
    harness.commands.setBlackWhiteMixEnabled(true);
    harness.commands.updateBlackWhiteMix(1, 48);

    expect(harness.adjustments().blackWhiteMix.enabled).toBe(true);
    expect(harness.adjustments().blackWhiteMix.luminance[1]).toBe(48);

    harness.commands.resetBlackWhiteMix(1);
    expect(harness.adjustments().blackWhiteMix.luminance[1]).toBe(0);
    harness.commands.resetGroup('blackWhiteMix');
    expect(harness.adjustments().blackWhiteMix.enabled).toBe(false);
  });

  it('authors a Grade Look and retains an exact zero-strength bypass', () => {
    const harness = createHarness();
    harness.commands.setGradeLookAsset('lut-cinema');
    harness.commands.updateGradeLookStrength(0);

    expect(harness.adjustments().gradeLook).toEqual({ assetId: 'lut-cinema', strength: 0 });
    harness.commands.resetGroup('look');
    expect(harness.adjustments().gradeLook).toEqual({ assetId: null, strength: 100 });
  });

  it('authors and resets Detail without disturbing Texture controls', () => {
    const harness = createHarness();
    harness.commands.updateAdjustment('texture', 32);
    harness.commands.updateDetail('luminanceNoiseReduction', 40);
    harness.commands.updateDetail('colorSmoothness', 75);
    expect(harness.adjustments().detail.luminanceNoiseReduction).toBe(40);
    expect(harness.adjustments().detail.colorSmoothness).toBe(75);

    harness.commands.resetDetail();
    expect(harness.adjustments().detail.luminanceNoiseReduction).toBe(0);
    expect(harness.adjustments().detail.colorSmoothness).toBe(50);
    expect(harness.adjustments().texture).toBe(32);
  });

  it('resets Grade without clearing the independent Lens FX pass', () => {
    const harness = createHarness();
    harness.commands.updateAdjustment('exposureEV', 2);
    harness.commands.updateLensDistortion('amount', 35);

    harness.commands.resetGrade();

    expect(harness.adjustments().exposureEV).toBe(0);
    expect(harness.adjustments().effects.lensDistortion.amount).toBe(35);
  });

  it('publishes lens viewport changes through host-neutral ports', () => {
    const harness = createHarness();

    harness.commands.setLensBlurViewportMode('depth');

    expect(harness.viewportMode()).toBe('depth');
    expect(harness.publishLensBlurViewportMode).toHaveBeenCalledWith('depth');
    expect(harness.endAdjustment).toHaveBeenCalled();
  });

  it('preserves effect enablement on reset and exits focus picking when blur is disabled', () => {
    const harness = createHarness();
    harness.commands.setLensBlurEnabled(true);
    harness.commands.updateLensBlur('apertureSize', 90);

    harness.commands.resetLensBlur();

    expect(harness.adjustments().effects.lensBlur.enabled).toBe(true);
    expect(harness.adjustments().effects.lensBlur.apertureSize).toBe(
      createDefaultAdjustments().effects.lensBlur.apertureSize
    );
    expect(harness.focusPickerActive()).toBe(false);

    harness.commands.setLensBlurEnabled(false);
    expect(harness.publishLensBlurViewportMode).toHaveBeenCalledWith('result');
    expect(harness.adjustments().effects.lensBlur.enabled).toBe(false);
    expect(harness.focusPickerActive()).toBe(false);
  });

  it('authors and resets the document-output Vignette through Lens FX state', () => {
    const harness = createHarness();

    harness.commands.setVignetteEnabled(true);
    harness.commands.updateVignette('amount', -72);
    harness.commands.updateVignette('roundness', 35);
    harness.commands.resetVignetteControl('roundness');

    expect(harness.adjustments().effects.vignette).toMatchObject({
      enabled: true,
      amount: -72,
      roundness: 0
    });

    harness.commands.resetVignette();
    expect(harness.adjustments().effects.vignette).toEqual({
      ...createDefaultAdjustments().effects.vignette,
      enabled: true
    });
  });

  it('copies curve input values instead of retaining mutable point objects', () => {
    const harness = createHarness();
    const points: BasicAdjustments['curves']['master'] = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.75 },
      { x: 1, y: 1 }
    ];

    harness.commands.updateCurve('master', points);
    points[1].y = 0.1;

    expect(harness.adjustments().curves.master[1].y).toBe(0.75);
  });

  it('publishes and resets an owned Gradient Map snapshot without retaining editor arrays', () => {
    const harness = createHarness();
    const gradientMap = {
      enabled: true,
      reverse: true,
      dither: true,
      colorStops: [
        { position: 0, midpoint: 0.5, color: { r: 1, g: 0, b: 0 } },
        { position: 1, midpoint: 0.5, color: { r: 0, g: 0, b: 1 } }
      ],
      opacityStops: [
        { position: 0, midpoint: 0.5, opacity: 1 },
        { position: 1, midpoint: 0.5, opacity: 0.75 }
      ]
    };

    harness.commands.updateGradientMap(gradientMap);
    gradientMap.colorStops[0].color.r = 0;

    expect(harness.adjustments().gradientMap).toMatchObject({ enabled: true, reverse: true });
    expect(harness.adjustments().gradientMap?.colorStops[0].color.r).toBe(1);
    harness.commands.resetGradientMap();
    expect(harness.adjustments().gradientMap).toEqual(createDefaultAdjustments().gradientMap);
    expect(harness.endAdjustment).toHaveBeenCalled();
  });
});
