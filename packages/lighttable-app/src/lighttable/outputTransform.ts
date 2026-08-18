import { curveActiveMask } from './curves';
import { halationIsActive } from './effects/halation/settings';
import { lensBlurIsActive } from './effects/lensBlur/settings';
import { cloneVignetteSettings, vignetteIsActive, type VignetteSettings } from './effects/vignette/settings';
import { pointColorIsActive } from './pointColor';
import { detailIsActive } from './detail';
import type { BasicAdjustments } from './types';

const positiveControlStrength = (value: number, fullScale: number, maximum: number) => {
  const normalized = Math.min(1, Math.max(0, value) / fullScale);
  const smooth = normalized * normalized * (3 - 2 * normalized);
  return smooth * maximum;
};

const maxValue = (values: readonly number[]) => Math.max(...values);
const sumAbsolute = (values: readonly number[]) => values.reduce((total, value) => total + Math.abs(value), 0);

export interface OutputTransformSettings {
  shoulderStrength: number;
  active: boolean;
  vignette: VignetteSettings;
}

export const calculateOutputTransformSettings = (adjustments: BasicAdjustments): OutputTransformSettings => {
  let shoulderStrength = positiveControlStrength(adjustments.exposureEV, 2, 1);
  shoulderStrength = Math.max(shoulderStrength, positiveControlStrength(adjustments.highlights, 100, 0.72));
  shoulderStrength = Math.max(shoulderStrength, positiveControlStrength(adjustments.texture, 100, 0.32));
  shoulderStrength = Math.max(shoulderStrength, positiveControlStrength(adjustments.clarity, 100, 0.32));
  shoulderStrength = Math.max(
    shoulderStrength,
    positiveControlStrength(adjustments.detail.sharpeningAmount, 150, 0.28)
  );
  if (vignetteIsActive(adjustments.effects.vignette)) {
    shoulderStrength = Math.max(
      shoulderStrength,
      positiveControlStrength(adjustments.effects.vignette.amount, 100, 0.72)
    );
  }
  shoulderStrength = Math.max(shoulderStrength, positiveControlStrength(maxValue(adjustments.colorMixer.luminance), 100, 0.72));
  shoulderStrength = Math.max(shoulderStrength, positiveControlStrength(maxValue(adjustments.colorGrading.luminance), 100, 0.72));
  shoulderStrength = Math.max(
    shoulderStrength,
    positiveControlStrength(
      maxValue([0, ...adjustments.pointColor.samples.map((sample) => sample.luminanceShift)]),
      100,
      0.72
    )
  );
  if (halationIsActive(adjustments.effects.halation)) {
    shoulderStrength = Math.max(
      shoulderStrength,
      positiveControlStrength(adjustments.effects.halation.amount, 100, 0.85)
    );
  }
  if (lensBlurIsActive(adjustments.effects.lensBlur)) {
    shoulderStrength = Math.max(
      shoulderStrength,
      positiveControlStrength(adjustments.effects.lensBlur.bokehBoost, 100, 0.55)
    );
  }

  const scalarMagnitude =
    Math.abs(adjustments.temperature) + Math.abs(adjustments.tint) + Math.abs(adjustments.exposureEV) +
    Math.abs(adjustments.contrast) + Math.abs(adjustments.highlights) + Math.abs(adjustments.shadows) +
    Math.abs(adjustments.whites) + Math.abs(adjustments.blacks) + Math.abs(adjustments.lift) +
    Math.abs(adjustments.texture) + Math.abs(adjustments.clarity) + Math.abs(adjustments.dehaze) +
    Math.abs(adjustments.vibrance) + Math.abs(adjustments.saturation);

  return {
    shoulderStrength: Math.min(1, Math.max(0, shoulderStrength)),
    vignette: cloneVignetteSettings(adjustments.effects.vignette),
    active: scalarMagnitude +
      sumAbsolute(adjustments.colorMixer.hue) + sumAbsolute(adjustments.colorMixer.saturation) +
      sumAbsolute(adjustments.colorMixer.luminance) + sumAbsolute(adjustments.colorGrading.saturation) +
      sumAbsolute(adjustments.colorGrading.luminance) + curveActiveMask(adjustments.curves) > 0.00001 ||
      halationIsActive(adjustments.effects.halation)
      || lensBlurIsActive(adjustments.effects.lensBlur)
      || pointColorIsActive(adjustments.pointColor)
      || detailIsActive(adjustments.detail)
      || vignetteIsActive(adjustments.effects.vignette)
  };
};
