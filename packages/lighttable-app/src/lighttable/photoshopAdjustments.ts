export type PhotoshopAdjustmentKind =
  | 'brightness-contrast'
  | 'levels'
  | 'exposure'
  | 'hue-saturation'
  | 'color-balance'
  | 'black-white'
  | 'photo-filter'
  | 'channel-mixer'
  | 'color-lookup'
  | 'selective-color'
  | 'invert'
  | 'posterize'
  | 'threshold';

export const PHOTOSHOP_ADJUSTMENT_KINDS: readonly PhotoshopAdjustmentKind[] = [
  'brightness-contrast', 'levels', 'exposure', 'hue-saturation', 'color-balance',
  'black-white', 'photo-filter', 'channel-mixer', 'color-lookup',
  'selective-color', 'invert', 'posterize', 'threshold'
];

export const isPhotoshopAdjustmentKind = (
  value: unknown
): value is PhotoshopAdjustmentKind => typeof value === 'string'
  && PHOTOSHOP_ADJUSTMENT_KINDS.includes(value as PhotoshopAdjustmentKind);

export type RgbTriplet = [number, number, number];
export type RgbaColor = { r: number; g: number; b: number; a: number };
export type LevelsChannel = 'rgb' | 'red' | 'green' | 'blue';
export interface LevelsChannelSettings {
  input: RgbTriplet;
  output: [number, number];
}
export type LevelsChannels = Record<LevelsChannel, LevelsChannelSettings>;

const createDefaultLevelsChannels = (): LevelsChannels => ({
  rgb: { input: [0, 1, 255], output: [0, 255] },
  red: { input: [0, 1, 255], output: [0, 255] },
  green: { input: [0, 1, 255], output: [0, 255] },
  blue: { input: [0, 1, 255], output: [0, 255] }
});

/**
 * Canonical authored payload for Photoshop-shaped nodes that do not map to a
 * pre-existing LightTable module. Only the fields belonging to `kind` are
 * presented, but retaining one fixed schema keeps history and GPU packing
 * deterministic while the node evaluator is extracted.
 */
export interface PhotoshopAdjustmentSettings {
  kind: PhotoshopAdjustmentKind;
  brightness: number;
  contrast: number;
  useLegacyBrightnessContrast: boolean;
  levelsChannel: LevelsChannel;
  levels: LevelsChannels;
  exposure: number;
  exposureOffset: number;
  exposureGamma: number;
  hue: number;
  hueSaturation: number;
  hueLightness: number;
  colorize: boolean;
  colorBalanceTone: 'shadows' | 'midtones' | 'highlights';
  colorBalanceShadows: RgbTriplet;
  colorBalanceMidtones: RgbTriplet;
  colorBalanceHighlights: RgbTriplet;
  preserveLuminosity: boolean;
  blackWhiteMix: [number, number, number, number, number, number];
  blackWhiteTint: boolean;
  blackWhiteTintColor: RgbaColor;
  photoFilterColor: RgbaColor;
  photoFilterDensity: number;
  channelMixerOutput: 'red' | 'green' | 'blue';
  channelMixerRed: [number, number, number, number];
  channelMixerGreen: [number, number, number, number];
  channelMixerBlue: [number, number, number, number];
  channelMixerMonochrome: boolean;
  colorLookupPreset: 'none' | 'film-stock' | 'moonlight' | 'teal-orange';
  colorLookupAssetId: string | null;
  selectiveColorRange: number;
  selectiveColorValues: number[];
  selectiveColorMethod: 'relative' | 'absolute';
  posterizeLevels: number;
  thresholdLevel: number;
}

export const createDefaultPhotoshopAdjustment = (
  kind: PhotoshopAdjustmentKind = 'brightness-contrast'
): PhotoshopAdjustmentSettings => ({
  kind,
  brightness: 0,
  contrast: 0,
  useLegacyBrightnessContrast: false,
  levelsChannel: 'rgb',
  levels: createDefaultLevelsChannels(),
  exposure: 0,
  exposureOffset: 0,
  exposureGamma: 1,
  hue: 0,
  hueSaturation: 0,
  hueLightness: 0,
  colorize: false,
  colorBalanceTone: 'midtones',
  colorBalanceShadows: [0, 0, 0],
  colorBalanceMidtones: [0, 0, 0],
  colorBalanceHighlights: [0, 0, 0],
  preserveLuminosity: true,
  blackWhiteMix: [40, 60, 40, 60, 20, 80],
  blackWhiteTint: false,
  blackWhiteTintColor: { r: 0.9, g: 0.72, b: 0.45, a: 1 },
  photoFilterColor: { r: 1, g: 0.55, b: 0.16, a: 1 },
  photoFilterDensity: 25,
  channelMixerOutput: 'red',
  channelMixerRed: [100, 0, 0, 0],
  channelMixerGreen: [0, 100, 0, 0],
  channelMixerBlue: [0, 0, 100, 0],
  channelMixerMonochrome: false,
  colorLookupPreset: 'none',
  colorLookupAssetId: null,
  selectiveColorRange: 0,
  selectiveColorValues: Array.from({ length: 36 }, () => 0),
  selectiveColorMethod: 'relative',
  posterizeLevels: 4,
  thresholdLevel: 128
});

export const clonePhotoshopAdjustment = (
  value: PhotoshopAdjustmentSettings
): PhotoshopAdjustmentSettings => {
  const defaults = createDefaultLevelsChannels();
  const legacy = value as PhotoshopAdjustmentSettings & {
    levelsInput?: RgbTriplet;
    levelsOutput?: [number, number];
  };
  const levels = value.levels
    ? {
      rgb: { ...defaults.rgb, ...value.levels.rgb },
      red: { ...defaults.red, ...value.levels.red },
      green: { ...defaults.green, ...value.levels.green },
      blue: { ...defaults.blue, ...value.levels.blue }
    }
    : defaults;
  if (!value.levels && legacy.levelsInput && legacy.levelsOutput) {
    levels[value.levelsChannel ?? 'rgb'] = {
      input: legacy.levelsInput,
      output: legacy.levelsOutput
    };
  }
  return structuredClone({ ...value, levels });
};
