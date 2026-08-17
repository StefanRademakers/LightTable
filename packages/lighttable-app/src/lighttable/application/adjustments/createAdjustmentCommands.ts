import {
  cloneColorGrading,
  colorGradingZoneIndex,
  createDefaultColorGrading,
  type ColorGradingValues,
  type ColorGradingZone
} from '../../colorGrading';
import {
  cloneColorMixer,
  createDefaultColorMixer,
  type ColorMixerChannel,
  type ColorMixerValues
} from '../../colorMixer';
import {
  clonePointColor,
  createDefaultPointColor,
  createPointColorSample,
  MAX_POINT_COLOR_SAMPLES,
  type PointColorSample
} from '../../pointColor';
import {
  cloneCurves,
  createDefaultCurves,
  createIdentityCurve,
  type CurveChannel,
  type ToneCurve
} from '../../curves';
import {
  createDefaultChromaticAberrationSettings,
  DEFAULT_CHROMATIC_ABERRATION_SETTINGS
} from '../../effects/chromaticAberration/settings';
import {
  createDefaultGrainSettings,
  DEFAULT_GRAIN_SETTINGS
} from '../../effects/grain/settings';
import {
  createDefaultHalationSettings,
  DEFAULT_HALATION_SETTINGS
} from '../../effects/halation/settings';
import {
  createDefaultLensBlurSettings,
  DEFAULT_LENS_BLUR_SETTINGS,
  type BokehShape,
  type LensBlurQuality
} from '../../effects/lensBlur/settings';
import {
  createDefaultLensDistortionSettings,
  DEFAULT_LENS_DISTORTION_SETTINGS
} from '../../effects/lensDistortion/settings';
import {
  createDefaultVignetteSettings,
  DEFAULT_VIGNETTE_SETTINGS
} from '../../effects/vignette/settings';
import { copyLightTableGrade, pasteGradeSettings } from '../../lightTableGradeClipboard';
import {
  createDefaultAdjustments,
  DEFAULT_BASIC_ADJUSTMENTS,
  type BasicAdjustments,
  type GradientMapAdjustments
} from '../../types';
import {
  COLOR_SLIDER_KEYS,
  EFFECTS_SLIDER_KEYS,
  LIGHT_SLIDER_KEYS,
  type GroupVisibility,
  type NumericAdjustmentKey
} from './groupVisibility';
import type {
  ChromaticAberrationNumericKey,
  GrainNumericKey,
  HalationNumericKey,
  LensBlurNumericKey,
  LensBlurViewportMode,
  LensDistortionNumericKey,
  VignetteNumericKey
} from '../../editor/config/adjustmentControls';
import type { AdjustmentPresentationDomain } from './adjustmentPresentationStore';
import {
  createDefaultPhotoshopAdjustment,
  type PhotoshopAdjustmentSettings
} from '../../photoshopAdjustments';

export interface AdjustmentCommandPorts {
  readonly beginAdjustment: () => void;
  readonly endAdjustment: () => void;
  readonly beginLensBlurInteraction: () => void;
  readonly endLensBlurInteraction: () => void;
  readonly changeAdjustments: (
    recipe: (current: BasicAdjustments) => BasicAdjustments,
    domain?: AdjustmentPresentationDomain
  ) => void;
  readonly getAdjustments: () => BasicAdjustments;
  readonly getGroupVisibility: () => GroupVisibility;
  readonly publishGroupVisibility: (visibility: GroupVisibility) => void;
  readonly setFocusPickerActive: (active: boolean) => void;
  readonly publishLensBlurViewportMode: (mode: LensBlurViewportMode) => void;
  readonly getSourceName: () => string;
  readonly publishGradeStatus: (status: string) => void;
}

export interface AdjustmentCommands {
  readonly updateAdjustment: (key: NumericAdjustmentKey, value: number) => void;
  readonly resetAdjustment: (key: NumericAdjustmentKey) => void;
  readonly updateGrain: (key: GrainNumericKey, value: number) => void;
  readonly resetGrainControl: (key: GrainNumericKey) => void;
  readonly resetGrain: () => void;
  readonly toggleGrain: () => void;
  readonly updateHalation: (key: HalationNumericKey, value: number) => void;
  readonly resetHalationControl: (key: HalationNumericKey) => void;
  readonly resetHalation: () => void;
  readonly setHalationEnabled: (enabled: boolean) => void;
  readonly updateChromaticAberration: (
    key: ChromaticAberrationNumericKey,
    value: number
  ) => void;
  readonly resetChromaticAberrationControl: (
    key: ChromaticAberrationNumericKey
  ) => void;
  readonly resetChromaticAberration: () => void;
  readonly setChromaticAberrationEnabled: (enabled: boolean) => void;
  readonly updateLensDistortion: (
    key: LensDistortionNumericKey,
    value: number
  ) => void;
  readonly resetLensDistortionControl: (key: LensDistortionNumericKey) => void;
  readonly resetLensDistortion: () => void;
  readonly setLensDistortionEnabled: (enabled: boolean) => void;
  readonly updateVignette: (key: VignetteNumericKey, value: number) => void;
  readonly resetVignetteControl: (key: VignetteNumericKey) => void;
  readonly resetVignette: () => void;
  readonly setVignetteEnabled: (enabled: boolean) => void;
  readonly updateLensBlur: (key: LensBlurNumericKey, value: number) => void;
  readonly resetLensBlurControl: (key: LensBlurNumericKey) => void;
  readonly resetLensBlur: () => void;
  readonly setLensBlurEnabled: (enabled: boolean) => void;
  readonly setLensBlurShape: (shape: BokehShape) => void;
  readonly setLensBlurQuality: (quality: LensBlurQuality) => void;
  readonly setLensBlurViewportMode: (mode: LensBlurViewportMode) => void;
  readonly updateColorMixer: (
    channel: ColorMixerChannel,
    index: number,
    value: number
  ) => void;
  readonly resetColorMixer: (channel: ColorMixerChannel, index: number) => void;
  readonly addPointColorSample: (
    id: string, lightness: number, chroma: number, hue: number
  ) => void;
  readonly updatePointColorSample: (
    id: string,
    key: Exclude<keyof PointColorSample, 'id' | 'lightness' | 'chroma' | 'hue'>,
    value: number
  ) => void;
  readonly resetPointColorSample: (id: string) => void;
  readonly removePointColorSample: (id: string) => void;
  readonly updateColorGradingWheel: (
    zone: ColorGradingZone,
    hue: number,
    saturation: number
  ) => void;
  readonly updateColorGradingLuminance: (
    zone: ColorGradingZone,
    value: number
  ) => void;
  readonly updateColorGradingControl: (
    control: 'blending' | 'balance',
    value: number
  ) => void;
  readonly resetColorGradingControl: (
    control: 'blending' | 'balance'
  ) => void;
  readonly resetColorGradingZone: (zone: ColorGradingZone) => void;
  readonly resetColorGradingLuminance: (zone: ColorGradingZone) => void;
  readonly updateCurve: (channel: CurveChannel, points: ToneCurve) => void;
  readonly resetCurve: (channel: CurveChannel) => void;
  readonly updateGradientMap: (value: GradientMapAdjustments) => void;
  readonly resetGradientMap: () => void;
  readonly updatePhotoshopAdjustment: (value: PhotoshopAdjustmentSettings) => void;
  readonly resetPhotoshopAdjustment: () => void;
  readonly resetAll: () => void;
  readonly toggleGroupVisibility: (group: keyof GroupVisibility) => void;
  readonly resetGroup: (group: keyof GroupVisibility) => void;
  readonly resetGrade: () => void;
  readonly copyGrade: () => void;
  readonly pasteGrade: (name: string, settings: BasicAdjustments) => void;
}

export const createAdjustmentCommands = (
  ports: AdjustmentCommandPorts
): AdjustmentCommands => {
  const changeEffect = <K extends keyof BasicAdjustments['effects']>(
    effect: K,
    recipe: (
      current: BasicAdjustments['effects'][K]
    ) => BasicAdjustments['effects'][K]
  ) => {
    ports.changeAdjustments((current) => ({
      ...current,
      effects: {
        ...current.effects,
        [effect]: recipe(current.effects[effect])
      }
    }), 'lens-fx');
  };

  const updateAdjustment = (key: NumericAdjustmentKey, value: number) => {
    ports.beginAdjustment();
    ports.changeAdjustments((current) => ({ ...current, [key]: value }));
  };

  const resetAdjustment = (key: NumericAdjustmentKey) => {
    ports.endAdjustment();
    ports.changeAdjustments((current) => ({
      ...current,
      [key]: DEFAULT_BASIC_ADJUSTMENTS[key]
    }));
  };

  const updateGradientMap = (value: GradientMapAdjustments) => {
    ports.beginAdjustment();
    ports.changeAdjustments((current) => ({
      ...current,
      gradientMap: structuredClone(value)
    }), 'grade');
  };

  const resetGradientMap = () => {
    ports.endAdjustment();
    ports.changeAdjustments((current) => ({
      ...current,
      gradientMap: structuredClone(DEFAULT_BASIC_ADJUSTMENTS.gradientMap)
    }), 'grade');
  };

  const updatePhotoshopAdjustment = (value: PhotoshopAdjustmentSettings) => {
    ports.beginAdjustment();
    ports.changeAdjustments((current) => ({
      ...current,
      photoshopAdjustment: structuredClone(value)
    }), 'grade');
  };

  const resetPhotoshopAdjustment = () => {
    ports.endAdjustment();
    ports.changeAdjustments((current) => ({
      ...current,
      photoshopAdjustment: createDefaultPhotoshopAdjustment(
        current.photoshopAdjustment.kind
      )
    }), 'grade');
  };

  const updateGrain = (key: GrainNumericKey, value: number) => {
    ports.beginAdjustment();
    changeEffect('grain', (current) => ({ ...current, [key]: value }));
  };

  const resetGrainControl = (key: GrainNumericKey) => {
    ports.endAdjustment();
    changeEffect('grain', (current) => ({
      ...current,
      [key]: DEFAULT_GRAIN_SETTINGS[key]
    }));
  };

  const resetGrain = () => {
    ports.endAdjustment();
    changeEffect('grain', (current) => ({
      ...createDefaultGrainSettings(),
      enabled: current.enabled
    }));
  };

  const toggleGrain = () => {
    ports.endAdjustment();
    changeEffect('grain', (current) => ({ ...current, enabled: !current.enabled }));
  };

  const updateHalation = (key: HalationNumericKey, value: number) => {
    ports.beginAdjustment();
    changeEffect('halation', (current) => ({ ...current, [key]: value }));
  };

  const resetHalationControl = (key: HalationNumericKey) => {
    ports.endAdjustment();
    changeEffect('halation', (current) => ({
      ...current,
      [key]: DEFAULT_HALATION_SETTINGS[key]
    }));
  };

  const resetHalation = () => {
    ports.endAdjustment();
    changeEffect('halation', (current) => ({
      ...createDefaultHalationSettings(),
      enabled: current.enabled
    }));
  };

  const setHalationEnabled = (enabled: boolean) => {
    ports.endAdjustment();
    changeEffect('halation', (current) => ({ ...current, enabled }));
  };

  const updateChromaticAberration = (
    key: ChromaticAberrationNumericKey,
    value: number
  ) => {
    ports.beginAdjustment();
    changeEffect('chromaticAberration', (current) => ({
      ...current,
      [key]: value
    }));
  };

  const resetChromaticAberrationControl = (
    key: ChromaticAberrationNumericKey
  ) => {
    ports.endAdjustment();
    changeEffect('chromaticAberration', (current) => ({
      ...current,
      [key]: DEFAULT_CHROMATIC_ABERRATION_SETTINGS[key]
    }));
  };

  const resetChromaticAberration = () => {
    ports.endAdjustment();
    changeEffect('chromaticAberration', (current) => ({
      ...createDefaultChromaticAberrationSettings(),
      enabled: current.enabled
    }));
  };

  const setChromaticAberrationEnabled = (enabled: boolean) => {
    ports.endAdjustment();
    changeEffect('chromaticAberration', (current) => ({ ...current, enabled }));
  };

  const updateLensDistortion = (
    key: LensDistortionNumericKey,
    value: number
  ) => {
    ports.beginAdjustment();
    changeEffect('lensDistortion', (current) => ({ ...current, [key]: value }));
  };

  const resetLensDistortionControl = (key: LensDistortionNumericKey) => {
    ports.endAdjustment();
    changeEffect('lensDistortion', (current) => ({
      ...current,
      [key]: DEFAULT_LENS_DISTORTION_SETTINGS[key]
    }));
  };

  const resetLensDistortion = () => {
    ports.endAdjustment();
    changeEffect('lensDistortion', (current) => ({
      ...createDefaultLensDistortionSettings(),
      enabled: current.enabled
    }));
  };

  const setLensDistortionEnabled = (enabled: boolean) => {
    ports.endAdjustment();
    changeEffect('lensDistortion', (current) => ({ ...current, enabled }));
  };

  const updateVignette = (key: VignetteNumericKey, value: number) => {
    ports.beginAdjustment();
    changeEffect('vignette', (current) => ({ ...current, [key]: value }));
  };

  const resetVignetteControl = (key: VignetteNumericKey) => {
    ports.endAdjustment();
    changeEffect('vignette', (current) => ({
      ...current,
      [key]: DEFAULT_VIGNETTE_SETTINGS[key]
    }));
  };

  const resetVignette = () => {
    ports.endAdjustment();
    changeEffect('vignette', (current) => ({
      ...createDefaultVignetteSettings(),
      enabled: current.enabled
    }));
  };

  const setVignetteEnabled = (enabled: boolean) => {
    ports.endAdjustment();
    changeEffect('vignette', (current) => ({ ...current, enabled }));
  };

  const updateLensBlur = (key: LensBlurNumericKey, value: number) => {
    ports.beginLensBlurInteraction();
    changeEffect('lensBlur', (current) => ({ ...current, [key]: value }));
  };

  const resetLensBlurControl = (key: LensBlurNumericKey) => {
    ports.endLensBlurInteraction();
    changeEffect('lensBlur', (current) => ({
      ...current,
      [key]: DEFAULT_LENS_BLUR_SETTINGS[key]
    }));
  };

  const resetLensBlur = () => {
    ports.endLensBlurInteraction();
    changeEffect('lensBlur', (current) => ({
      ...createDefaultLensBlurSettings(),
      enabled: current.enabled
    }));
    ports.setFocusPickerActive(false);
  };

  const setLensBlurEnabled = (enabled: boolean) => {
    ports.endLensBlurInteraction();
    changeEffect('lensBlur', (current) => ({ ...current, enabled }));
    if (!enabled) {
      ports.setFocusPickerActive(false);
      ports.publishLensBlurViewportMode('result');
    }
  };

  const setLensBlurShape = (shape: BokehShape) => {
    ports.endLensBlurInteraction();
    changeEffect('lensBlur', (current) => ({
      ...current,
      bokehShape: shape
    }));
  };

  const setLensBlurQuality = (quality: LensBlurQuality) => {
    ports.endLensBlurInteraction();
    changeEffect('lensBlur', (current) => ({ ...current, quality }));
  };

  const setLensBlurViewportMode = (mode: LensBlurViewportMode) => {
    ports.endLensBlurInteraction();
    ports.publishLensBlurViewportMode(mode);
  };

  const updateColorMixer = (
    channel: ColorMixerChannel,
    index: number,
    value: number
  ) => {
    ports.beginAdjustment();
    ports.changeAdjustments((current) => {
      const values = [...current.colorMixer[channel]] as ColorMixerValues;
      values[index] = value;
      return {
        ...current,
        colorMixer: { ...cloneColorMixer(current.colorMixer), [channel]: values }
      };
    });
  };

  const resetColorMixer = (channel: ColorMixerChannel, index: number) => {
    ports.endAdjustment();
    ports.changeAdjustments((current) => {
      const values = [...current.colorMixer[channel]] as ColorMixerValues;
      values[index] = 0;
      return {
        ...current,
        colorMixer: { ...cloneColorMixer(current.colorMixer), [channel]: values }
      };
    });
  };

  const addPointColorSample = (
    id: string,
    lightness: number,
    chroma: number,
    hue: number
  ) => {
    ports.endAdjustment();
    ports.changeAdjustments((current) => {
      if (current.pointColor.samples.length >= MAX_POINT_COLOR_SAMPLES) return current;
      return {
        ...current,
        pointColor: {
          samples: [
            ...clonePointColor(current.pointColor).samples,
            createPointColorSample(id, lightness, chroma, hue)
          ]
        }
      };
    });
  };

  const updatePointColorSample = (
    id: string,
    key: Exclude<keyof PointColorSample, 'id' | 'lightness' | 'chroma' | 'hue'>,
    value: number
  ) => {
    ports.beginAdjustment();
    ports.changeAdjustments((current) => ({
      ...current,
      pointColor: {
        samples: current.pointColor.samples.map((sample) =>
          sample.id === id ? { ...sample, [key]: value } : { ...sample })
      }
    }));
  };

  const resetPointColorSample = (id: string) => {
    ports.endAdjustment();
    ports.changeAdjustments((current) => ({
      ...current,
      pointColor: {
        samples: current.pointColor.samples.map((sample) => sample.id === id
          ? createPointColorSample(sample.id, sample.lightness, sample.chroma, sample.hue)
          : { ...sample })
      }
    }));
  };

  const removePointColorSample = (id: string) => {
    ports.endAdjustment();
    ports.changeAdjustments((current) => ({
      ...current,
      pointColor: {
        samples: current.pointColor.samples.filter((sample) => sample.id !== id)
      }
    }));
  };

  const updateColorGradingWheel = (
    zone: ColorGradingZone,
    hue: number,
    saturation: number
  ) => {
    ports.beginAdjustment();
    ports.changeAdjustments((current) => {
      const index = colorGradingZoneIndex(zone);
      const next = cloneColorGrading(current.colorGrading);
      next.hue[index] = hue;
      next.saturation[index] = saturation;
      return { ...current, colorGrading: next };
    });
  };

  const updateColorGradingLuminance = (
    zone: ColorGradingZone,
    value: number
  ) => {
    ports.beginAdjustment();
    ports.changeAdjustments((current) => {
      const index = colorGradingZoneIndex(zone);
      const luminance = [...current.colorGrading.luminance] as ColorGradingValues;
      luminance[index] = value;
      return {
        ...current,
        colorGrading: { ...cloneColorGrading(current.colorGrading), luminance }
      };
    });
  };

  const updateColorGradingControl = (
    control: 'blending' | 'balance',
    value: number
  ) => {
    ports.beginAdjustment();
    ports.changeAdjustments((current) => ({
      ...current,
      colorGrading: {
        ...cloneColorGrading(current.colorGrading),
        [control]: value
      }
    }));
  };

  const resetColorGradingControl = (
    control: 'blending' | 'balance'
  ) => {
    ports.endAdjustment();
    ports.changeAdjustments((current) => ({
      ...current,
      colorGrading: {
        ...cloneColorGrading(current.colorGrading),
        [control]: DEFAULT_BASIC_ADJUSTMENTS.colorGrading[control]
      }
    }));
  };

  const resetColorGradingZone = (zone: ColorGradingZone) => {
    ports.endAdjustment();
    ports.changeAdjustments((current) => {
      const index = colorGradingZoneIndex(zone);
      const next = cloneColorGrading(current.colorGrading);
      next.hue[index] = 0;
      next.saturation[index] = 0;
      next.luminance[index] = 0;
      return { ...current, colorGrading: next };
    });
  };

  const resetColorGradingLuminance = (zone: ColorGradingZone) => {
    ports.endAdjustment();
    ports.changeAdjustments((current) => {
      const index = colorGradingZoneIndex(zone);
      const luminance = [...current.colorGrading.luminance] as ColorGradingValues;
      luminance[index] = 0;
      return {
        ...current,
        colorGrading: { ...cloneColorGrading(current.colorGrading), luminance }
      };
    });
  };

  const updateCurve = (channel: CurveChannel, points: ToneCurve) => {
    ports.changeAdjustments((current) => ({
      ...current,
      curves: {
        ...cloneCurves(current.curves),
        [channel]: points.map((point) => ({ ...point }))
      }
    }));
  };

  const resetCurve = (channel: CurveChannel) => {
    ports.endAdjustment();
    ports.changeAdjustments((current) => ({
      ...current,
      curves: {
        ...cloneCurves(current.curves),
        [channel]: createIdentityCurve()
      }
    }));
  };

  const resetAll = () => {
    ports.endAdjustment();
    ports.changeAdjustments(() => createDefaultAdjustments(), 'all');
  };

  const toggleGroupVisibility = (group: keyof GroupVisibility) => {
    const current = ports.getGroupVisibility();
    ports.publishGroupVisibility({ ...current, [group]: !current[group] });
  };

  const resetGroup = (group: keyof GroupVisibility) => {
    ports.endAdjustment();
    ports.changeAdjustments((current) => {
      if (group === 'colorMixer') {
        return {
          ...current,
          colorMixer: createDefaultColorMixer(),
          pointColor: createDefaultPointColor()
        };
      }
      if (group === 'colorGrading') {
        return { ...current, colorGrading: createDefaultColorGrading() };
      }
      if (group === 'curves') {
        return {
          ...current,
          curves: createDefaultCurves(current.curves.interpolation ?? 'monotone')
        };
      }
      const keys = group === 'light'
        ? LIGHT_SLIDER_KEYS
        : group === 'color'
          ? COLOR_SLIDER_KEYS
          : EFFECTS_SLIDER_KEYS;
      const next = { ...current };
      keys.forEach((key) => {
        next[key] = DEFAULT_BASIC_ADJUSTMENTS[key];
      });
      return next;
    });
  };

  const copyGrade = () => {
    copyLightTableGrade(ports.getAdjustments(), ports.getSourceName());
    ports.publishGradeStatus('Grade copied');
  };

  const resetGrade = () => {
    ports.endAdjustment();
    ports.changeAdjustments(
      (current) => pasteGradeSettings(current, createDefaultAdjustments()),
      'grade'
    );
    ports.publishGradeStatus('Global Grade reset');
  };

  const pasteGrade = (name: string, settings: BasicAdjustments) => {
    ports.endAdjustment();
    ports.changeAdjustments((current) => pasteGradeSettings(current, settings), 'grade');
    ports.publishGradeStatus(`Loaded ${name}`);
  };

  return {
    updateAdjustment,
    resetAdjustment,
    updateGrain,
    resetGrainControl,
    resetGrain,
    toggleGrain,
    updateHalation,
    resetHalationControl,
    resetHalation,
    setHalationEnabled,
    updateChromaticAberration,
    resetChromaticAberrationControl,
    resetChromaticAberration,
    setChromaticAberrationEnabled,
    updateLensDistortion,
    resetLensDistortionControl,
    resetLensDistortion,
    setLensDistortionEnabled,
    updateVignette,
    resetVignetteControl,
    resetVignette,
    setVignetteEnabled,
    updateLensBlur,
    resetLensBlurControl,
    resetLensBlur,
    setLensBlurEnabled,
    setLensBlurShape,
    setLensBlurQuality,
    setLensBlurViewportMode,
    updateColorMixer,
    resetColorMixer,
    addPointColorSample,
    updatePointColorSample,
    resetPointColorSample,
    removePointColorSample,
    updateColorGradingWheel,
    updateColorGradingLuminance,
    updateColorGradingControl,
    resetColorGradingControl,
    resetColorGradingZone,
    resetColorGradingLuminance,
    updateCurve,
    resetCurve,
    updateGradientMap,
    resetGradientMap,
    updatePhotoshopAdjustment,
    resetPhotoshopAdjustment,
    resetAll,
    toggleGroupVisibility,
    resetGroup,
    resetGrade,
    copyGrade,
    pasteGrade
  };
};
