import type { SegmentedControlOption } from '../../../ui/SegmentedControl';
import type { AdjustmentSliderTrack } from '../../../ui/AdjustmentSlider';
import type {
  NumericAdjustmentKey
} from '../../application/adjustments/groupVisibility';
import { BASIC_ADJUSTMENT_RANGES } from '../../application/adjustments/groupVisibility';
import type { ColorGradingMode } from '../../colorGrading';
import {
  COLOR_MIXER_DISPLAY_CENTERS,
  type ColorMixerChannel
} from '../../colorMixer';
import type { ChromaticAberrationSettings } from '../../effects/chromaticAberration/settings';
import type { GrainSettings } from '../../effects/grain/settings';
import type { HalationSettings } from '../../effects/halation/settings';
import type {
  BokehShape,
  LensBlurQuality,
  LensBlurSettings
} from '../../effects/lensBlur/settings';
import type { LensDistortionSettings } from '../../effects/lensDistortion/settings';
import type { VignetteSettings } from '../../effects/vignette/settings';
import type { DetailAdjustments } from '../../detail';

export interface SliderDefinition<TKey = NumericAdjustmentKey> {
  readonly key: TKey;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly format?: (value: number) => string;
  readonly track?: AdjustmentSliderTrack;
}

export type GrainNumericKey = Exclude<keyof GrainSettings, 'enabled'>;
export type GrainSliderDefinition = SliderDefinition<GrainNumericKey>;
export type HalationNumericKey = Exclude<keyof HalationSettings, 'enabled'>;
export type ChromaticAberrationNumericKey = Exclude<
  keyof ChromaticAberrationSettings,
  'enabled'
>;
export type LensDistortionNumericKey = Exclude<
  keyof LensDistortionSettings,
  'enabled'
>;
export type LensBlurNumericKey = Exclude<
  keyof LensBlurSettings,
  'enabled' | 'bokehShape' | 'quality'
>;
export type LensBlurSliderDefinition = SliderDefinition<LensBlurNumericKey>;

export const COLOR_TEMPERATURE_RANGE = BASIC_ADJUSTMENT_RANGES.temperature;

const SLIDERS: ReadonlyArray<SliderDefinition> = [
  { key: 'temperature', label: 'Temperature', ...COLOR_TEMPERATURE_RANGE, track: 'temperature' },
  { key: 'tint', label: 'Tint', ...BASIC_ADJUSTMENT_RANGES.tint, track: 'tint' },
  { key: 'exposureEV', label: 'Exposure', ...BASIC_ADJUSTMENT_RANGES.exposureEV, step: 0.01, format: (value) => `${value.toFixed(2)} EV`, track: 'luminance' },
  { key: 'contrast', label: 'Contrast', ...BASIC_ADJUSTMENT_RANGES.contrast, track: 'luminance' },
  { key: 'highlights', label: 'Highlights', ...BASIC_ADJUSTMENT_RANGES.highlights, track: 'luminance' },
  { key: 'shadows', label: 'Shadows', ...BASIC_ADJUSTMENT_RANGES.shadows, track: 'luminance' },
  { key: 'whites', label: 'Whites', ...BASIC_ADJUSTMENT_RANGES.whites, track: 'luminance' },
  { key: 'blacks', label: 'Blacks', ...BASIC_ADJUSTMENT_RANGES.blacks, track: 'luminance' },
  { key: 'lift', label: 'Lift', ...BASIC_ADJUSTMENT_RANGES.lift, track: 'luminance' },
  { key: 'texture', label: 'Texture', ...BASIC_ADJUSTMENT_RANGES.texture, track: 'luminance' },
  { key: 'clarity', label: 'Clarity', ...BASIC_ADJUSTMENT_RANGES.clarity, track: 'luminance' },
  { key: 'dehaze', label: 'Dehaze', ...BASIC_ADJUSTMENT_RANGES.dehaze, track: 'luminance' },
  { key: 'vibrance', label: 'Vibrance', ...BASIC_ADJUSTMENT_RANGES.vibrance, track: 'vibrance' },
  { key: 'saturation', label: 'Saturation', ...BASIC_ADJUSTMENT_RANGES.saturation, track: 'saturation' }
];

const LIGHT_KEYS = new Set<NumericAdjustmentKey>([
  'exposureEV', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'lift'
]);
const COLOR_KEYS = new Set<NumericAdjustmentKey>([
  'temperature', 'tint', 'vibrance', 'saturation'
]);
const EFFECT_KEYS = new Set<NumericAdjustmentKey>([
  'texture', 'clarity', 'dehaze'
]);

export type VignetteNumericKey = Exclude<keyof VignetteSettings, 'enabled'>;
export const VIGNETTE_SLIDERS: ReadonlyArray<SliderDefinition<VignetteNumericKey>> = [
  { key: 'amount', label: 'Amount', min: -100, max: 100, track: 'luminance' },
  { key: 'midpoint', label: 'Midpoint', min: 0, max: 100, format: (value) => `${Math.round(value)}%` },
  { key: 'roundness', label: 'Roundness', min: -100, max: 100 },
  { key: 'feather', label: 'Feather', min: 0, max: 100, format: (value) => `${Math.round(value)}%` },
  { key: 'highlights', label: 'Highlights', min: 0, max: 100, format: (value) => `${Math.round(value)}%`, track: 'luminance' }
];

export const LIGHT_SLIDERS = SLIDERS.filter(({ key }) => LIGHT_KEYS.has(key));
export const COLOR_SLIDERS = SLIDERS.filter(({ key }) => COLOR_KEYS.has(key));
export const EFFECTS_SLIDERS = SLIDERS.filter(({ key }) => EFFECT_KEYS.has(key));

export type DetailSliderDefinition = SliderDefinition<keyof DetailAdjustments>;
export const DETAIL_SHARPENING_SLIDERS: readonly DetailSliderDefinition[] = [
  { key: 'sharpeningAmount', label: 'Amount', min: 0, max: 150 },
  { key: 'sharpeningRadius', label: 'Radius', min: 0.5, max: 3, step: 0.05,
    format: (value) => value.toFixed(2) },
  { key: 'sharpeningDetail', label: 'Detail', min: 0, max: 100 },
  { key: 'sharpeningMasking', label: 'Masking', min: 0, max: 100 }
];
export const DETAIL_NOISE_SLIDERS: readonly DetailSliderDefinition[] = [
  { key: 'luminanceNoiseReduction', label: 'Luminance', min: 0, max: 100 },
  { key: 'luminanceDetail', label: 'Luminance Detail', min: 0, max: 100 },
  { key: 'luminanceContrast', label: 'Luminance Contrast', min: 0, max: 100 },
  { key: 'colorNoiseReduction', label: 'Color', min: 0, max: 100 },
  { key: 'colorDetail', label: 'Color Detail', min: 0, max: 100 },
  { key: 'colorSmoothness', label: 'Color Smoothness', min: 0, max: 100 }
];

export const GRAIN_SLIDERS: ReadonlyArray<
  SliderDefinition<Exclude<keyof GrainSettings, 'enabled'>>
> = [
  { key: 'amount', label: 'Amount', min: 0, max: 3, step: 0.01, format: (value) => value.toFixed(2) },
  { key: 'size', label: 'Size', min: 0.25, max: 2.5, step: 0.01, format: (value) => value.toFixed(2) },
  { key: 'softness', label: 'Softness', min: 0, max: 2, step: 0.01, format: (value) => value.toFixed(2) },
  { key: 'color', label: 'Color', min: 0, max: 100, format: (value) => `${Math.round(value)}%` },
  { key: 'shadowResponse', label: 'Shadow Response', min: 0.25, max: 4, step: 0.01, format: (value) => value.toFixed(2) },
  { key: 'blend', label: 'Blend', min: 0, max: 100, format: (value) => `${Math.round(value)}%` },
  { key: 'seed', label: 'Seed', min: 1, max: 200 }
];

export const GRAIN_ADVANCED_SLIDERS: ReadonlyArray<
  SliderDefinition<Exclude<keyof GrainSettings, 'enabled'>>
> = [
  { key: 'redScale', label: 'Red scale', min: 0.25, max: 3, step: 0.01, format: (value) => value.toFixed(2) },
  { key: 'greenScale', label: 'Green scale', min: 0.25, max: 3, step: 0.01, format: (value) => value.toFixed(2) },
  { key: 'blueScale', label: 'Blue scale', min: 0.25, max: 3, step: 0.01, format: (value) => value.toFixed(2) },
  { key: 'redContrast', label: 'Red noise contrast', min: 0.25, max: 2.5, step: 0.01, format: (value) => value.toFixed(2) },
  { key: 'greenContrast', label: 'Green noise contrast', min: 0.25, max: 2.5, step: 0.01, format: (value) => value.toFixed(2) },
  { key: 'blueContrast', label: 'Blue noise contrast', min: 0.25, max: 2.5, step: 0.01, format: (value) => value.toFixed(2) }
];

export const HALATION_SLIDERS: ReadonlyArray<
  SliderDefinition<Exclude<keyof HalationSettings, 'enabled'>>
> = [
  { key: 'amount', label: 'Amount', min: 0, max: 100, format: (value) => `${Math.round(value)}%` },
  { key: 'radius', label: 'Radius', min: 0, max: 100, format: (value) => `${Math.round(value)}%` },
  { key: 'threshold', label: 'Threshold', min: 0, max: 100, format: (value) => `${Math.round(value)}%` },
  { key: 'warmth', label: 'Warmth', min: 0, max: 100, format: (value) => `${Math.round(value)}%`, track: 'temperature' }
];

export const CHROMATIC_ABERRATION_SLIDERS: ReadonlyArray<
  SliderDefinition<Exclude<keyof ChromaticAberrationSettings, 'enabled'>>
> = [
  { key: 'amount', label: 'Amount', min: 0, max: 100, format: (value) => `${Math.round(value)}%` },
  { key: 'falloff', label: 'Edge falloff', min: 0, max: 100, format: (value) => `${Math.round(value)}%` },
  { key: 'balance', label: 'Red / Blue balance', min: -100, max: 100, track: 'tint' }
];

export const LENS_DISTORTION_SLIDERS: ReadonlyArray<
  SliderDefinition<Exclude<keyof LensDistortionSettings, 'enabled'>>
> = [
  { key: 'amount', label: 'Distortion', min: -100, max: 100 },
  { key: 'midpoint', label: 'Midpoint', min: 0, max: 100, format: (value) => `${Math.round(value)}%` },
  { key: 'zoom', label: 'Zoom', min: 0, max: 100, format: (value) => `${Math.round(value)}%` }
];

export type LensBlurViewportMode = 'result' | 'depth';

export const LENS_BLUR_SLIDERS: ReadonlyArray<
  SliderDefinition<Exclude<keyof LensBlurSettings, 'enabled' | 'bokehShape' | 'quality'>>
> = [
  { key: 'apertureSize', label: 'Aperture Size', min: 0, max: 100, format: (value) => `${Math.round(value)}%` },
  { key: 'focusDistance', label: 'Focus Distance', min: 0, max: 1, step: 0.005, format: (value) => `${Math.round(value * 100)}%` },
  { key: 'depthOfField', label: 'Depth of Field', min: 0.01, max: 0.8, step: 0.005, format: (value) => `${Math.round(value * 100)}%` },
  { key: 'catEye', label: 'Cat Eye', min: 0, max: 100, format: (value) => `${Math.round(value)}%` },
  { key: 'bokehBoost', label: 'Bokeh Boost', min: 0, max: 100, format: (value) => `${Math.round(value)}%` },
  { key: 'transitionFeather', label: 'Transition Feather', min: 0.01, max: 0.4, step: 0.005, format: (value) => `${Math.round(value * 100)}%` }
];

export const BOKEH_SHAPE_OPTIONS: Array<
  SegmentedControlOption<BokehShape>
> = [
  { value: 'circle', label: 'Round' },
  { value: 'hexagon', label: 'Hex' },
  { value: 'anamorphic', label: 'Oval' },
  { value: 'donut', label: 'Donut' }
];

export const LENS_BLUR_QUALITY_OPTIONS: Array<
  SegmentedControlOption<LensBlurQuality>
> = [
  { value: 'balanced', label: '48' },
  { value: 'high', label: '64' },
  { value: 'ultra', label: '128' }
];

export const LENS_BLUR_VIEWPORT_MODE_OPTIONS: Array<
  SegmentedControlOption<LensBlurViewportMode>
> = [
  { value: 'result', label: 'Result' },
  { value: 'depth', label: 'Depth' }
];

export const MIXER_CHANNEL_LABELS: Readonly<Record<ColorMixerChannel, string>> = {
  hue: 'Hue',
  saturation: 'Saturation',
  luminance: 'Luminance'
};

const wrapUnit = (value: number) => ((value % 1) + 1) % 1;

export const colorMixerRangeBounds = (index: number) => {
  const count = COLOR_MIXER_DISPLAY_CENTERS.length;
  const center = COLOR_MIXER_DISPLAY_CENTERS[index];
  const previous = COLOR_MIXER_DISPLAY_CENTERS[(index + count - 1) % count];
  const next = COLOR_MIXER_DISPLAY_CENTERS[(index + 1) % count];
  const previousDistance = wrapUnit(center - previous);
  const nextDistance = wrapUnit(next - center);
  return {
    start: wrapUnit(center - previousDistance / 2),
    end: wrapUnit(center + nextDistance / 2)
  };
};

export const nearestColorMixerRange = (position: number) => {
  let selected = 0;
  let selectedDistance = Number.POSITIVE_INFINITY;
  COLOR_MIXER_DISPLAY_CENTERS.forEach((center, index) => {
    const direct = Math.abs(position - center);
    const distance = Math.min(direct, 1 - direct);
    if (distance < selectedDistance) {
      selected = index;
      selectedDistance = distance;
    }
  });
  return selected;
};

export const GRADING_MODE_OPTIONS: Array<
  SegmentedControlOption<ColorGradingMode>
> = [
  { value: 'all', label: '3-Way', title: 'Three-way grading' },
  { value: 'global', label: 'Global' },
  { value: 'shadows', label: 'Shadows' },
  { value: 'midtones', label: 'Midtones' },
  { value: 'highlights', label: 'Highlights' }
];
