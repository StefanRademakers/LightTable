import type { DetailAdjustments } from '../../detail';

export type NumericAdjustmentKey =
  | 'temperature' | 'tint' | 'exposureEV' | 'contrast' | 'highlights' | 'shadows'
  | 'whites' | 'blacks' | 'lift' | 'texture' | 'clarity' | 'dehaze'
  | 'vibrance' | 'saturation';

export interface NumericConstraint {
  readonly min: number;
  readonly max: number;
  readonly integer?: boolean;
}

export const BASIC_ADJUSTMENT_RANGES: Readonly<Record<
  NumericAdjustmentKey, NumericConstraint
>> = {
  temperature: { min: -100, max: 100 }, tint: { min: -100, max: 100 },
  exposureEV: { min: -5, max: 5 }, contrast: { min: -100, max: 100 },
  highlights: { min: -100, max: 100 }, shadows: { min: -100, max: 100 },
  whites: { min: -100, max: 100 }, blacks: { min: -100, max: 100 },
  lift: { min: -100, max: 100 }, texture: { min: -100, max: 100 },
  clarity: { min: -100, max: 100 }, dehaze: { min: -100, max: 100 },
  vibrance: { min: -100, max: 100 }, saturation: { min: -100, max: 100 }
};

export const DETAIL_ADJUSTMENT_RANGES: Readonly<Record<
  keyof DetailAdjustments, NumericConstraint
>> = Object.freeze({
  sharpeningAmount: { min: 0, max: 150 }, sharpeningRadius: { min: 0.5, max: 3 },
  sharpeningDetail: { min: 0, max: 100 }, sharpeningMasking: { min: 0, max: 100 },
  luminanceNoiseReduction: { min: 0, max: 100 }, luminanceDetail: { min: 0, max: 100 },
  luminanceContrast: { min: 0, max: 100 }, colorNoiseReduction: { min: 0, max: 100 },
  colorDetail: { min: 0, max: 100 }, colorSmoothness: { min: 0, max: 100 }
});

const exact: Readonly<Record<string, NumericConstraint>> = {
  'colorGrading.blending': { min: 0, max: 100 },
  'colorGrading.balance': { min: -100, max: 100 },
  'gradeLook.strength': { min: 0, max: 100 },
  'photoshopAdjustment.brightness': { min: -150, max: 150 },
  'photoshopAdjustment.contrast': { min: -50, max: 100 },
  'photoshopAdjustment.exposure': { min: -20, max: 20 },
  'photoshopAdjustment.exposureOffset': { min: -0.5, max: 0.5 },
  'photoshopAdjustment.exposureGamma': { min: 0.01, max: 9.99 },
  'photoshopAdjustment.vibrance': { min: -100, max: 100 },
  'photoshopAdjustment.vibranceSaturation': { min: -100, max: 100 },
  'photoshopAdjustment.colorVibranceTemperature': { min: -100, max: 100 },
  'photoshopAdjustment.colorVibranceTint': { min: -100, max: 100 },
  'photoshopAdjustment.colorVibranceVibrance': { min: -100, max: 100 },
  'photoshopAdjustment.colorVibranceSaturation': { min: -100, max: 100 },
  'photoshopAdjustment.hue': { min: -180, max: 360 },
  'photoshopAdjustment.hueSaturation': { min: -100, max: 100 },
  'photoshopAdjustment.hueLightness': { min: -100, max: 100 },
  'photoshopAdjustment.photoFilterDensity': { min: 1, max: 100 },
  'photoshopAdjustment.selectiveColorRange': { min: 0, max: 8, integer: true },
  'photoshopAdjustment.posterizeLevels': { min: 2, max: 255, integer: true },
  'photoshopAdjustment.thresholdLevel': { min: 1, max: 255, integer: true },
  'effects.grain.amount': { min: 0, max: 3 },
  'effects.grain.size': { min: 0.25, max: 2.5 },
  'effects.grain.softness': { min: 0, max: 2 },
  'effects.grain.color': { min: 0, max: 100 },
  'effects.grain.shadowResponse': { min: 0.25, max: 4 },
  'effects.grain.blend': { min: 0, max: 100 },
  'effects.grain.seed': { min: 1, max: 200, integer: true },
  'effects.grain.redScale': { min: 0.25, max: 3 },
  'effects.grain.greenScale': { min: 0.25, max: 3 },
  'effects.grain.blueScale': { min: 0.25, max: 3 },
  'effects.grain.redContrast': { min: 0.25, max: 2.5 },
  'effects.grain.greenContrast': { min: 0.25, max: 2.5 },
  'effects.grain.blueContrast': { min: 0.25, max: 2.5 },
  'effects.halation.amount': { min: 0, max: 100 },
  'effects.halation.radius': { min: 0, max: 100 },
  'effects.halation.threshold': { min: 0, max: 100 },
  'effects.halation.warmth': { min: 0, max: 100 },
  'effects.chromaticAberration.amount': { min: 0, max: 100 },
  'effects.chromaticAberration.falloff': { min: 0, max: 100 },
  'effects.chromaticAberration.balance': { min: -100, max: 100 },
  'effects.lensDistortion.amount': { min: -100, max: 100 },
  'effects.lensDistortion.midpoint': { min: 0, max: 100 },
  'effects.lensDistortion.zoom': { min: 0, max: 100 },
  'effects.lensBlur.apertureSize': { min: 0, max: 100 },
  'effects.lensBlur.focusDistance': { min: 0, max: 1 },
  'effects.lensBlur.depthOfField': { min: 0.01, max: 0.8 },
  'effects.lensBlur.catEye': { min: 0, max: 100 },
  'effects.lensBlur.bokehBoost': { min: 0, max: 100 },
  'effects.lensBlur.transitionFeather': { min: 0.01, max: 0.4 },
  'effects.vignette.amount': { min: -100, max: 100 },
  'effects.vignette.midpoint': { min: 0, max: 100 },
  'effects.vignette.roundness': { min: -100, max: 100 },
  'effects.vignette.feather': { min: 0, max: 100 },
  'effects.vignette.highlights': { min: 0, max: 100 }
};

const matches = (path: string): NumericConstraint | undefined => {
  if (/^colorMixer\.(hue|saturation|luminance)\[\]$/.test(path)
    || path === 'blackWhiteMix.luminance[]') return { min: -100, max: 100 };
  if (path === 'colorGrading.hue[]') return { min: 0, max: 360 };
  if (path === 'colorGrading.saturation[]') return { min: 0, max: 100 };
  if (path === 'colorGrading.luminance[]') return { min: -100, max: 100 };
  if (/^pointColor\.samples\[\]\.(hueShift|saturationShift|luminanceShift|variance)$/.test(path)) {
    return { min: -100, max: 100 };
  }
  if (/^pointColor\.samples\[\]\.(range|hueRange|saturationRange|luminanceRange)$/.test(path)) {
    return { min: 0, max: 100 };
  }
  if (path === 'pointColor.samples[].lightness') return { min: 0, max: 1 };
  if (path === 'pointColor.samples[].chroma') return { min: 0, max: 1 };
  if (path === 'pointColor.samples[].hue') return { min: -Math.PI, max: Math.PI };
  if (/^photoshopAdjustment\.hueSaturationRanges\.[^.]+\.boundaries\[\]$/.test(path)) {
    return { min: 0, max: 360 };
  }
  if (/^photoshopAdjustment\.hueSaturationRanges\.[^.]+\.hue$/.test(path)) {
    return { min: -180, max: 180 };
  }
  if (/^photoshopAdjustment\.hueSaturationRanges\.[^.]+\.(saturation|lightness)$/.test(path)
    || path === 'photoshopAdjustment.selectiveColorValues[]') return { min: -100, max: 100 };
  if (/^photoshopAdjustment\.colorBalance(Shadows|Midtones|Highlights)\[\]$/.test(path)) {
    return { min: -100, max: 100 };
  }
  if (path === 'photoshopAdjustment.blackWhiteMix[]') return { min: -200, max: 300 };
  if (/^photoshopAdjustment\.(blackWhiteTintColor|photoFilterColor)\.(r|g|b|a)$/.test(path)) {
    return { min: 0, max: 1 };
  }
  if (/^photoshopAdjustment\.channelMixer(Red|Green|Blue)\[\]$/.test(path)) {
    return { min: -200, max: 200 };
  }
  return undefined;
};

/** Canonical authored numeric semantics used by transport/history validation. */
export const adjustmentNumberConstraint = (path: string): NumericConstraint | undefined => {
  if (path in BASIC_ADJUSTMENT_RANGES) {
    return BASIC_ADJUSTMENT_RANGES[path as NumericAdjustmentKey];
  }
  if (path.startsWith('detail.')) {
    return DETAIL_ADJUSTMENT_RANGES[path.slice(7) as keyof DetailAdjustments];
  }
  return exact[path] ?? matches(path);
};
