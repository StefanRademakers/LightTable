import { curveActiveMask } from '../curves';
import type { BasicAdjustments } from '../types';

export const ADJUSTMENT_UNIFORM_FLOATS = 60;
export const LINEAR_COMPOSITE_FLAG_INDEX = 18;

/**
 * Packs the shared Adjustments uniform used by the basic and creative passes.
 * Keep this layout aligned with both WGSL Adjustments structs in shaders.ts.
 */
export const buildAdjustmentUniform = (
  value: BasicAdjustments,
  sourceWidth: number,
  sourceHeight: number,
  inputIsLinearComposite: boolean
) => new Float32Array([
  value.temperature,
  value.tint,
  value.exposureEV,
  value.contrast,
  value.highlights,
  value.shadows,
  value.whites,
  value.blacks,
  value.clarity,
  value.vibrance,
  value.saturation,
  value.texture,
  value.dehaze,
  value.vignette,
  value.lift,
  sourceWidth,
  sourceHeight,
  curveActiveMask(value.curves),
  inputIsLinearComposite ? 1 : 0,
  0,
  ...value.colorMixer.hue,
  ...value.colorMixer.saturation,
  ...value.colorMixer.luminance,
  ...value.colorGrading.hue,
  ...value.colorGrading.saturation,
  ...value.colorGrading.luminance,
  value.colorGrading.blending,
  value.colorGrading.balance,
  0,
  0
]);
