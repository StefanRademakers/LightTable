import {
  cloneAdjustments,
  createDefaultAdjustments,
  type BasicAdjustments
} from './types';
import { type ColorMixerChannel, type ColorMixerValues } from './colorMixer';
import { MAX_POINT_COLOR_SAMPLES, type PointColorSample } from './pointColor';
import { type ColorGradingValues } from './colorGrading';
import { type ColorMixerValues as BlackWhiteMixValues } from './colorMixer';
import { CURVE_CHANNELS, normalizeCurvePoints, type CurvePoint } from './curves';
import { createDefaultGrainSettings } from './effects/grain/settings';
import { createDefaultHalationSettings } from './effects/halation/settings';
import { createDefaultChromaticAberrationSettings } from './effects/chromaticAberration/settings';
import { createDefaultLensDistortionSettings } from './effects/lensDistortion/settings';
import { createDefaultLensBlurSettings, LENS_BLUR_QUALITIES } from './effects/lensBlur/settings';
import { createDefaultVignetteSettings } from './effects/vignette/settings';

export interface LightTableRecipe {
  sourceFileKey: string;
  settings: BasicAdjustments;
  /** Mix for the document-final Global Grade pass. Layer grades use layer opacity. */
  globalGradeStrength?: number;
  documentFormat?: 'embedded-layered-png';
}

const isObject = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const parseEffectSettings = <Settings extends object>(raw: unknown, defaults: Settings) => {
  if (!isObject(raw)) return null;
  const settings = { ...defaults };
  const mutable = settings as Record<keyof Settings, unknown>;
  let recognized = 0;
  (Object.keys(defaults) as Array<keyof Settings>).forEach((key) => {
    const value = raw[String(key)];
    const defaultValue = defaults[key];
    if (typeof defaultValue === 'boolean' && typeof value === 'boolean') {
      mutable[key] = value;
      recognized += 1;
    } else if (typeof defaultValue === 'number' && typeof value === 'number' && Number.isFinite(value)) {
      mutable[key] = value;
      recognized += 1;
    } else if (typeof defaultValue === 'string' && typeof value === 'string') {
      mutable[key] = value;
      recognized += 1;
    }
  });
  return recognized > 0 ? { settings, recognized } : null;
};

export const createLightTableRecipe = (
  sourceFileKey: string,
  settings: BasicAdjustments,
  documentFormat?: LightTableRecipe['documentFormat'],
  globalGradeStrength = 100
): LightTableRecipe => ({
  sourceFileKey,
  settings: cloneAdjustments(settings),
  ...(globalGradeStrength === 100 ? {} : {
    globalGradeStrength: Math.min(100, Math.max(0, globalGradeStrength))
  }),
  ...(documentFormat ? { documentFormat } : {})
});

/**
 * A flat correction reopens its original source and reapplies the recipe.
 * A layered document must reopen the selected container because its pixels,
 * masks, and layer stack live in that file; its sourceFileKey remains the
 * provenance key used when exporting the next recipe.
 */
export const resolveLightTableEditorSourceKey = (
  selectedFileKey: string | null | undefined,
  recipe: LightTableRecipe | null | undefined
) => recipe?.documentFormat === 'embedded-layered-png'
  ? selectedFileKey ?? null
  : recipe?.sourceFileKey ?? selectedFileKey ?? null;

/**
 * Resolve the provenance key written into an exported recipe. Hosted media
 * keeps its object-storage key; standalone files get a metadata-only local
 * identifier so saving does not depend on a server integration.
 */
export const resolveLightTableSaveSourceKey = (
  selectedFileKey: string | null | undefined,
  recipe: LightTableRecipe | null | undefined,
  localFileName?: string | null
) => recipe?.sourceFileKey
  ?? selectedFileKey
  ?? (localFileName ? `local:${encodeURIComponent(localFileName)}` : null);

export const parseLightTableSettings = (value: unknown): BasicAdjustments | null => {
  if (!isObject(value)) return null;

  const settings = createDefaultAdjustments();
  let recognizedSettings = 0;
  (Object.keys(settings) as Array<keyof BasicAdjustments>).forEach((key) => {
    if (key === 'colorMixer' || key === 'pointColor' || key === 'colorGrading' || key === 'blackWhiteMix' || key === 'curves'
      || key === 'gradientMap' || key === 'photoshopAdjustment' || key === 'detail'
      || key === 'effects') return;
    const settingValue = value[key];
    if (typeof settingValue === 'number' && Number.isFinite(settingValue)) {
      (settings as unknown as Record<string, number>)[key] = settingValue;
      recognizedSettings += 1;
    }
  });

  const rawDetail = value.detail;
  if (isObject(rawDetail)) {
    (Object.keys(settings.detail) as Array<keyof typeof settings.detail>).forEach((key) => {
      const detailValue = rawDetail[key];
      if (typeof detailValue === 'number' && Number.isFinite(detailValue)) {
        settings.detail[key] = detailValue;
        recognizedSettings += 1;
      }
    });
  }

  const rawColorMixer = value.colorMixer;
  if (isObject(rawColorMixer)) {
    (['hue', 'saturation', 'luminance'] as ColorMixerChannel[]).forEach((channel) => {
      const values = rawColorMixer[channel];
      if (Array.isArray(values) && values.length === 8 && values.every((entry) => typeof entry === 'number' && Number.isFinite(entry))) {
        settings.colorMixer[channel] = [...values] as ColorMixerValues;
        recognizedSettings += 1;
      }
    });
  }

  const rawPointColor = value.pointColor;
  if (isObject(rawPointColor) && Array.isArray(rawPointColor.samples)) {
    const numericKeys = [
      'lightness', 'chroma', 'hue', 'hueShift', 'saturationShift',
      'luminanceShift', 'variance', 'range', 'hueRange',
      'saturationRange', 'luminanceRange'
    ] as const;
    const samples = rawPointColor.samples.slice(0, MAX_POINT_COLOR_SAMPLES).filter((sample) =>
      isObject(sample)
      && typeof sample.id === 'string'
      && numericKeys.every((key) => typeof sample[key] === 'number' && Number.isFinite(sample[key]))
    ) as unknown as PointColorSample[];
    if (samples.length > 0 || rawPointColor.samples.length === 0) {
      settings.pointColor = { samples: samples.map((sample) => ({ ...sample })) };
      recognizedSettings += 1;
    }
  }

  const rawColorGrading = value.colorGrading;
  if (isObject(rawColorGrading)) {
    (['hue', 'saturation', 'luminance'] as const).forEach((channel) => {
      const values = rawColorGrading[channel];
      if (Array.isArray(values) && values.length === 4 && values.every((entry) => typeof entry === 'number' && Number.isFinite(entry))) {
        settings.colorGrading[channel] = [...values] as ColorGradingValues;
        recognizedSettings += 1;
      }
    });
    for (const control of ['blending', 'balance'] as const) {
      const controlValue = rawColorGrading[control];
      if (typeof controlValue === 'number' && Number.isFinite(controlValue)) {
        settings.colorGrading[control] = controlValue;
        recognizedSettings += 1;
      }
    }
  }

  const rawBlackWhiteMix = value.blackWhiteMix;
  if (isObject(rawBlackWhiteMix)) {
    if (typeof rawBlackWhiteMix.enabled === 'boolean') {
      settings.blackWhiteMix.enabled = rawBlackWhiteMix.enabled;
      recognizedSettings += 1;
    }
    const luminance = rawBlackWhiteMix.luminance;
    if (Array.isArray(luminance) && luminance.length === 8
      && luminance.every((entry) => typeof entry === 'number' && Number.isFinite(entry))) {
      settings.blackWhiteMix.luminance = [...luminance] as BlackWhiteMixValues;
      recognizedSettings += 1;
    }
  }

  const rawCurves = value.curves;
  if (isObject(rawCurves)) {
    CURVE_CHANNELS.forEach((channel) => {
      const points = rawCurves[channel];
      if (Array.isArray(points) && points.length >= 2 && points.length <= 32 && points.every((point) => (
        isObject(point) && typeof point.x === 'number' && Number.isFinite(point.x) &&
        typeof point.y === 'number' && Number.isFinite(point.y)
      ))) {
        settings.curves[channel] = normalizeCurvePoints(points as unknown as CurvePoint[]);
        recognizedSettings += 1;
      }
    });
  }

  const rawGradientMap = value.gradientMap;
  if (isObject(rawGradientMap)
    && typeof rawGradientMap.enabled === 'boolean'
    && typeof rawGradientMap.reverse === 'boolean'
    && typeof rawGradientMap.dither === 'boolean'
    && Array.isArray(rawGradientMap.colorStops)
    && rawGradientMap.colorStops.length >= 2
    && rawGradientMap.colorStops.length <= 8
    && rawGradientMap.colorStops.every((stop) => {
      if (!isObject(stop) || !isObject(stop.color)) return false;
      const color = stop.color;
      return typeof stop.position === 'number' && Number.isFinite(stop.position)
        && typeof stop.midpoint === 'number' && Number.isFinite(stop.midpoint)
        && ['r', 'g', 'b'].every((channel) => typeof color[channel] === 'number'
          && Number.isFinite(color[channel]));
    })
    && Array.isArray(rawGradientMap.opacityStops)
    && rawGradientMap.opacityStops.length >= 2
    && rawGradientMap.opacityStops.length <= 8
    && rawGradientMap.opacityStops.every((stop) => isObject(stop)
      && typeof stop.position === 'number' && Number.isFinite(stop.position)
      && typeof stop.midpoint === 'number' && Number.isFinite(stop.midpoint)
      && typeof stop.opacity === 'number' && Number.isFinite(stop.opacity))) {
    settings.gradientMap = structuredClone(rawGradientMap) as unknown as NonNullable<BasicAdjustments['gradientMap']>;
    recognizedSettings += 1;
  }

  const rawEffects = value.effects;
  if (isObject(rawEffects)) {
    const grain = parseEffectSettings(rawEffects.grain, createDefaultGrainSettings());
    if (grain) {
      settings.effects.grain = grain.settings;
      recognizedSettings += grain.recognized;
    }
    const halation = parseEffectSettings(rawEffects.halation, createDefaultHalationSettings());
    if (halation) {
      settings.effects.halation = halation.settings;
      recognizedSettings += halation.recognized;
    }
    const chromaticAberration = parseEffectSettings(
      rawEffects.chromaticAberration,
      createDefaultChromaticAberrationSettings()
    );
    if (chromaticAberration) {
      settings.effects.chromaticAberration = chromaticAberration.settings;
      recognizedSettings += chromaticAberration.recognized;
    }
    const lensDistortion = parseEffectSettings(
      rawEffects.lensDistortion,
      createDefaultLensDistortionSettings()
    );
    if (lensDistortion) {
      settings.effects.lensDistortion = lensDistortion.settings;
      recognizedSettings += lensDistortion.recognized;
    }
    const lensBlur = parseEffectSettings(rawEffects.lensBlur, createDefaultLensBlurSettings());
    if (lensBlur) {
      if (!['circle', 'hexagon', 'anamorphic', 'donut'].includes(lensBlur.settings.bokehShape)) {
        lensBlur.settings.bokehShape = createDefaultLensBlurSettings().bokehShape;
      }
      if (!LENS_BLUR_QUALITIES.includes(lensBlur.settings.quality)) {
        lensBlur.settings.quality = createDefaultLensBlurSettings().quality;
      }
      settings.effects.lensBlur = lensBlur.settings;
      recognizedSettings += lensBlur.recognized;
    }
    const vignette = parseEffectSettings(rawEffects.vignette, createDefaultVignetteSettings());
    if (vignette) {
      settings.effects.vignette = vignette.settings;
      recognizedSettings += vignette.recognized;
    }
  }

  return recognizedSettings > 0 ? settings : null;
};

export const parseLightTableRecipe = (metadataJson: unknown): LightTableRecipe | null => {
  if (!isObject(metadataJson) || !isObject(metadataJson.lighttable)) return null;

  const candidate = metadataJson.lighttable;
  const sourceFileKey = typeof candidate.sourceFileKey === 'string'
    ? candidate.sourceFileKey.trim()
    : '';
  const settings = parseLightTableSettings(candidate.settings);
  const documentFormat = candidate.documentFormat === 'embedded-layered-png'
    ? candidate.documentFormat
    : undefined;
  const globalGradeStrength = typeof candidate.globalGradeStrength === 'number'
    && Number.isFinite(candidate.globalGradeStrength)
    ? Math.min(100, Math.max(0, candidate.globalGradeStrength))
    : undefined;
  return sourceFileKey && settings ? {
    sourceFileKey,
    settings,
    ...(globalGradeStrength === undefined ? {} : { globalGradeStrength }),
    ...(documentFormat ? { documentFormat } : {})
  } : null;
};

export const resolveLightTableRecipe = async (
  resolveMetadata: (projectId: string, fileKey: string) => Promise<unknown>,
  projectId: string,
  fileKey: string
): Promise<LightTableRecipe | null> => {
  return parseLightTableRecipe(await resolveMetadata(projectId, fileKey));
};
