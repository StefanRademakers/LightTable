import { curveActiveMask } from '../curves';
import type { BasicAdjustments } from '../types';

export const ADJUSTMENT_UNIFORM_FLOATS = 256;
export const LINEAR_COMPOSITE_FLAG_INDEX = 18;

export interface ColorLookupUniform {
  readonly enabled: boolean;
  readonly domainMin: readonly [number, number, number];
  readonly domainMax: readonly [number, number, number];
}

/**
 * Packs the shared Adjustments uniform used by the basic and creative passes.
 * Keep this layout aligned with both WGSL Adjustments structs in shaders.ts.
 */
export const buildAdjustmentUniform = (
  value: BasicAdjustments,
  sourceWidth: number,
  sourceHeight: number,
  inputIsLinearComposite: boolean,
  colorLookup: ColorLookupUniform | null = null
) => {
  const gradientMap = value.gradientMap;
  const colorStops = [...(gradientMap?.colorStops ?? [])]
    .sort((left, right) => left.position - right.position).slice(0, 8);
  const opacityStops = [...(gradientMap?.opacityStops ?? [])]
    .sort((left, right) => left.position - right.position).slice(0, 8);
  const packed = new Float32Array(ADJUSTMENT_UNIFORM_FLOATS);
  packed.set([
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
  packed.set([
    gradientMap?.enabled ? 1 : 0,
    colorStops.length,
    opacityStops.length,
    (gradientMap?.reverse ? 1 : 0) + (gradientMap?.dither ? 2 : 0)
  ], 60);
  colorStops.forEach((stop, index) => packed.set([
    stop.color.r, stop.color.g, stop.color.b, stop.position
  ], 64 + index * 4));
  for (let index = 0; index < 8; index += 1) {
    const stop = opacityStops[index];
    packed.set([
      stop?.position ?? 0,
      stop?.opacity ?? 1,
      stop?.midpoint ?? 0.5,
      colorStops[index]?.midpoint ?? 0.5
    ], 96 + index * 4);
  }
  const photoshop = value.photoshopAdjustment;
  const kindIndex = [
    'brightness-contrast', 'levels', 'exposure', 'hue-saturation',
    'color-balance', 'black-white', 'photo-filter', 'channel-mixer',
    'color-lookup', 'selective-color', 'invert', 'posterize', 'threshold'
  ].indexOf(photoshop.kind) + 1;
  packed.set([
    kindIndex,
    photoshop.brightness,
    photoshop.contrast,
    photoshop.useLegacyBrightnessContrast ? 1 : 0,
    ...photoshop.levelsInput,
    photoshop.levelsOutput[0],
    photoshop.levelsOutput[1],
    photoshop.exposure,
    photoshop.exposureOffset,
    photoshop.exposureGamma,
    photoshop.hue,
    photoshop.hueSaturation,
    photoshop.hueLightness,
    photoshop.colorize ? 1 : 0,
    ...photoshop.colorBalanceShadows,
    ...photoshop.colorBalanceMidtones,
    ...photoshop.colorBalanceHighlights,
    photoshop.preserveLuminosity ? 1 : 0,
    ...photoshop.blackWhiteMix,
    photoshop.blackWhiteTint ? 1 : 0,
    photoshop.blackWhiteTintColor.r,
    photoshop.blackWhiteTintColor.g,
    photoshop.blackWhiteTintColor.b,
    photoshop.blackWhiteTintColor.a,
    photoshop.photoFilterColor.r,
    photoshop.photoFilterColor.g,
    photoshop.photoFilterColor.b,
    photoshop.photoFilterColor.a,
    photoshop.photoFilterDensity,
    ['red', 'green', 'blue'].indexOf(photoshop.channelMixerOutput),
    ...photoshop.channelMixerRed,
    ...photoshop.channelMixerGreen,
    ...photoshop.channelMixerBlue,
    photoshop.channelMixerMonochrome ? 1 : 0,
    colorLookup?.enabled ? 1 : 0,
    photoshop.selectiveColorRange,
    photoshop.selectiveColorMethod === 'absolute' ? 1 : 0,
    ...photoshop.selectiveColorValues.slice(0, 36),
    photoshop.posterizeLevels,
    photoshop.thresholdLevel,
    ['rgb', 'red', 'green', 'blue'].indexOf(photoshop.levelsChannel),
    ['none', 'film-stock', 'moonlight', 'teal-orange'].indexOf(photoshop.colorLookupPreset)
  ], 128);
  packed.set([
    ...(colorLookup?.domainMin ?? [0, 0, 0]),
    ...(colorLookup?.domainMax ?? [1, 1, 1])
  ], 227);
  return packed;
};
