import { curveActiveMask } from '../curves';
import type { DocumentBitDepth, DocumentBlendProfile } from '../editor/document/documentTypes';
import type { BasicAdjustments } from '../types';
import {
  buildPhotoshopBrightnessContrastLut,
  PHOTOSHOP_BRIGHTNESS_CONTRAST_LUT_SIZE
} from './photoshopBrightnessContrastLut';

export const ADJUSTMENT_UNIFORM_FLOATS = 368;
export const LINEAR_COMPOSITE_FLAG_INDEX = 18;
export const PHOTOSHOP_PAYLOAD_OFFSET = 128;
export const PHOTOSHOP_LEVELS_CHANNELS_OFFSET = 233;
export const PHOTOSHOP_BRIGHTNESS_CONTRAST_LUT_OFFSET = 248;
export const PHOTOSHOP_BLEND_PROFILE_OFFSET = 313;
export const PHOTOSHOP_HUE_SATURATION_RANGES_OFFSET = 314;
export const PHOTOSHOP_VIBRANCE_OFFSET = 356;
export const PHOTOSHOP_DOCUMENT_BIT_DEPTH_OFFSET = 362;

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
  colorLookup: ColorLookupUniform | null = null,
  photoshopBlendProfile: DocumentBlendProfile = 'srgb',
  documentBitDepth: DocumentBitDepth = 16
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
    (gradientMap?.reverse ? 1 : 0)
      + (gradientMap?.dither ? 2 : 0)
      + (gradientMap?.interpolation === 'perceptual' ? 4 : gradientMap?.interpolation === 'linear' ? 8 : 0)
      + (gradientMap?.photoshopCompatible ? 16 : 0)
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
    'color-lookup', 'selective-color', 'invert', 'posterize', 'threshold',
    'vibrance', 'color-vibrance'
  ].indexOf(photoshop.kind) + 1;
  packed.set([
    kindIndex,
    photoshop.brightness,
    photoshop.contrast,
    photoshop.useLegacyBrightnessContrast ? 1 : 0,
    ...photoshop.levels.rgb.input,
    ...photoshop.levels.rgb.output,
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
    ...photoshop.levels.red.input, ...photoshop.levels.red.output,
    ...photoshop.levels.green.input, ...photoshop.levels.green.output,
    ...photoshop.levels.blue.input, ...photoshop.levels.blue.output
  ], PHOTOSHOP_LEVELS_CHANNELS_OFFSET);
  if (photoshop.kind === 'brightness-contrast') {
    const transfer = buildPhotoshopBrightnessContrastLut(
      photoshop.brightness,
      photoshop.contrast
    );
    if (transfer.length !== PHOTOSHOP_BRIGHTNESS_CONTRAST_LUT_SIZE) {
      throw new Error('Photoshop Brightness/Contrast LUT has an invalid size.');
    }
    packed.set(transfer, PHOTOSHOP_BRIGHTNESS_CONTRAST_LUT_OFFSET);
  }
  packed[PHOTOSHOP_BLEND_PROFILE_OFFSET] = photoshopBlendProfile === 'adobe-rgb-1998' ? 1 : 0;
  packed.set(
    (['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas'] as const).flatMap((channel) => {
      const range = photoshop.hueSaturationRanges[channel];
      return [...range.boundaries, range.hue, range.saturation, range.lightness];
    }),
    PHOTOSHOP_HUE_SATURATION_RANGES_OFFSET
  );
  packed.set([
    photoshop.vibrance,
    photoshop.vibranceSaturation
  ], PHOTOSHOP_VIBRANCE_OFFSET);
  packed[PHOTOSHOP_DOCUMENT_BIT_DEPTH_OFFSET] = documentBitDepth;
  packed.set([
    ...(colorLookup?.domainMin ?? [0, 0, 0]),
    ...(colorLookup?.domainMax ?? [1, 1, 1])
  ], 227);
  return packed;
};
