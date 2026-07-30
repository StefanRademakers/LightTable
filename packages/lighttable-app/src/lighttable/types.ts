import { cloneColorMixer, createDefaultColorMixer, type ColorMixerAdjustments } from './colorMixer';
import { cloneColorGrading, createDefaultColorGrading, type ColorGradingAdjustments } from './colorGrading';
import { cloneCurves, createDefaultCurves, type CurvesAdjustments } from './curves';
import { cloneEffects, createDefaultEffects, type LightTableEffects } from './effects/types';

export interface BasicAdjustments {
  temperature: number;
  tint: number;
  exposureEV: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  lift: number;
  texture: number;
  clarity: number;
  dehaze: number;
  vignette: number;
  vibrance: number;
  saturation: number;
  colorMixer: ColorMixerAdjustments;
  colorGrading: ColorGradingAdjustments;
  curves: CurvesAdjustments;
  effects: LightTableEffects;
}

export interface LightTableImageMetadata {
  name: string;
  width: number;
  height: number;
  contentType: string;
  decoder?: 'browser' | 'wasm-vips' | 'ag-psd';
  sourceBitDepth?: number;
  sourceFormat?: string;
  sourceInterpretation?: string;
  sourceProfile?: 'embedded ICC -> sRGB' | 'no embedded ICC; assumed sRGB';
  decodeDurationMs?: number;
}

export interface LightTableViewState {
  scale: number;
  panX: number;
  panY: number;
}

export interface RgbHistogram {
  red: Uint32Array;
  green: Uint32Array;
  blue: Uint32Array;
}

export const DEFAULT_BASIC_ADJUSTMENTS: Readonly<BasicAdjustments> = Object.freeze({
  temperature: 0,
  tint: 0,
  exposureEV: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  lift: 0,
  texture: 0,
  clarity: 0,
  dehaze: 0,
  vignette: 0,
  vibrance: 0,
  saturation: 0,
  colorMixer: createDefaultColorMixer(),
  colorGrading: createDefaultColorGrading(),
  curves: createDefaultCurves(),
  effects: createDefaultEffects()
});

export const cloneAdjustments = (adjustments: BasicAdjustments): BasicAdjustments => ({
  ...adjustments,
  colorMixer: cloneColorMixer(adjustments.colorMixer),
  colorGrading: cloneColorGrading(adjustments.colorGrading),
  curves: cloneCurves(adjustments.curves),
  effects: cloneEffects(adjustments.effects)
});

export const createDefaultAdjustments = (): BasicAdjustments => ({
  ...DEFAULT_BASIC_ADJUSTMENTS,
  colorMixer: cloneColorMixer(DEFAULT_BASIC_ADJUSTMENTS.colorMixer),
  colorGrading: cloneColorGrading(DEFAULT_BASIC_ADJUSTMENTS.colorGrading),
  curves: cloneCurves(DEFAULT_BASIC_ADJUSTMENTS.curves),
  effects: cloneEffects(DEFAULT_BASIC_ADJUSTMENTS.effects)
});
