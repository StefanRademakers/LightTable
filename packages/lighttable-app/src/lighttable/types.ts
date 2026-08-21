import { cloneColorMixer, createDefaultColorMixer, type ColorMixerAdjustments } from './colorMixer';
import { cloneColorGrading, createDefaultColorGrading, type ColorGradingAdjustments } from './colorGrading';
import { cloneCurves, createDefaultCurves, type CurvesAdjustments } from './curves';
import { cloneEffects, createDefaultEffects, type LightTableEffects } from './effects/types';
import { clonePointColor, createDefaultPointColor, type PointColorAdjustments } from './pointColor';
import { cloneDetail, createDefaultDetail, type DetailAdjustments } from './detail';
import {
  cloneBlackWhiteMix,
  createDefaultBlackWhiteMix,
  type BlackWhiteMixAdjustments
} from './blackWhiteMix';
import {
  clonePhotoshopAdjustment,
  createDefaultPhotoshopAdjustment,
  type PhotoshopAdjustmentSettings
} from './photoshopAdjustments';
import { cloneGradeLook, createDefaultGradeLook, type GradeLookAdjustments } from './gradeLook';

export interface GradientMapStop {
  position: number;
  midpoint: number;
  color: { r: number; g: number; b: number };
}

export interface GradientMapOpacityStop {
  position: number;
  midpoint: number;
  opacity: number;
}

export interface GradientMapAdjustments {
  enabled: boolean;
  reverse: boolean;
  dither: boolean;
  interpolation?: 'classic' | 'perceptual' | 'linear' | 'smooth';
  photoshopCompatible?: boolean;
  colorStops: GradientMapStop[];
  opacityStops: GradientMapOpacityStop[];
}

export const createDefaultGradientMap = (): GradientMapAdjustments => ({
  enabled: false,
  reverse: false,
  dither: false,
  interpolation: 'classic',
  photoshopCompatible: false,
  colorStops: [
    { position: 0, midpoint: 0.5, color: { r: 0, g: 0, b: 0 } },
    { position: 1, midpoint: 0.5, color: { r: 1, g: 1, b: 1 } }
  ],
  opacityStops: [
    { position: 0, midpoint: 0.5, opacity: 1 },
    { position: 1, midpoint: 0.5, opacity: 1 }
  ]
});

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
  vibrance: number;
  saturation: number;
  detail: DetailAdjustments;
  colorMixer: ColorMixerAdjustments;
  pointColor: PointColorAdjustments;
  colorGrading: ColorGradingAdjustments;
  blackWhiteMix: BlackWhiteMixAdjustments;
  gradeLook: GradeLookAdjustments;
  curves: CurvesAdjustments;
  /** Optional during alpha-format reads; defaults always materialize it. */
  gradientMap?: GradientMapAdjustments;
  photoshopAdjustment: PhotoshopAdjustmentSettings;
  effects: LightTableEffects;
}

export interface LightTableImageMetadata {
  name: string;
  width: number;
  height: number;
  contentType: string;
  decoder?: 'browser' | 'wasm-vips' | 'ag-psd' | 'pdfjs' | 'native-svg';
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
  vibrance: 0,
  saturation: 0,
  detail: createDefaultDetail(),
  colorMixer: createDefaultColorMixer(),
  pointColor: createDefaultPointColor(),
  colorGrading: createDefaultColorGrading(),
  blackWhiteMix: createDefaultBlackWhiteMix(),
  gradeLook: createDefaultGradeLook(),
  curves: createDefaultCurves(),
  gradientMap: createDefaultGradientMap(),
  photoshopAdjustment: createDefaultPhotoshopAdjustment(),
  effects: createDefaultEffects()
});

export const cloneAdjustments = (adjustments: BasicAdjustments): BasicAdjustments => ({
  ...adjustments,
  colorMixer: cloneColorMixer(adjustments.colorMixer),
  pointColor: clonePointColor(adjustments.pointColor ?? createDefaultPointColor()),
  detail: cloneDetail(adjustments.detail ?? createDefaultDetail()),
  colorGrading: cloneColorGrading(adjustments.colorGrading),
  blackWhiteMix: cloneBlackWhiteMix(adjustments.blackWhiteMix ?? createDefaultBlackWhiteMix()),
  gradeLook: cloneGradeLook(adjustments.gradeLook ?? createDefaultGradeLook()),
  curves: cloneCurves(adjustments.curves),
  gradientMap: structuredClone(adjustments.gradientMap ?? createDefaultGradientMap()),
  photoshopAdjustment: clonePhotoshopAdjustment(
    adjustments.photoshopAdjustment ?? createDefaultPhotoshopAdjustment()
  ),
  effects: cloneEffects(adjustments.effects)
});

export const createDefaultAdjustments = (): BasicAdjustments => ({
  ...DEFAULT_BASIC_ADJUSTMENTS,
  colorMixer: cloneColorMixer(DEFAULT_BASIC_ADJUSTMENTS.colorMixer),
  pointColor: clonePointColor(DEFAULT_BASIC_ADJUSTMENTS.pointColor),
  detail: cloneDetail(DEFAULT_BASIC_ADJUSTMENTS.detail),
  colorGrading: cloneColorGrading(DEFAULT_BASIC_ADJUSTMENTS.colorGrading),
  blackWhiteMix: cloneBlackWhiteMix(DEFAULT_BASIC_ADJUSTMENTS.blackWhiteMix),
  gradeLook: cloneGradeLook(DEFAULT_BASIC_ADJUSTMENTS.gradeLook),
  curves: cloneCurves(DEFAULT_BASIC_ADJUSTMENTS.curves),
  gradientMap: structuredClone(DEFAULT_BASIC_ADJUSTMENTS.gradientMap ?? createDefaultGradientMap()),
  photoshopAdjustment: clonePhotoshopAdjustment(DEFAULT_BASIC_ADJUSTMENTS.photoshopAdjustment),
  effects: cloneEffects(DEFAULT_BASIC_ADJUSTMENTS.effects)
});
