import type {
  AdjustmentLayer as PsdAdjustment,
  Color as PsdColor,
  CurvesAdjustmentChannel,
  LevelsAdjustmentChannel,
  LayerEffectsInfo
} from 'ag-psd';
import type { DocumentAssetBlob } from '../persistence/layeredDocumentFormat';
import type { BlendMode } from '../document/blendModes';
import { BLEND_MODES } from '../document/blendModes';
import {
  createDefaultLayerLocks,
  semanticLayerDependencyKey,
  type ColorLookupAsset,
  type DocumentAssetId,
  type DocumentId,
  type ImageDocument,
  type AdjustmentLayer,
  type LayerId,
  type LayerNode,
  type PhotoshopImportCompatibilityEntry,
  type PhotoshopImportSupport,
  type RasterLayer,
  type TextLayer,
  type VectorLayer
} from '../document/documentTypes';
import { identityAffineMatrix } from '../rendering/renderContract';
import { translationMatrix } from '../tools/transform/affine';
import { importPsdLayerStyles } from './layerStylePsdAdapter';
import { importPsdVectorShape } from './psdVectorShapeAdapter';
import { importPsdText } from './psdTextAdapter';
import type { PsdDecodeSuccess, PsdLayerNodeDto } from '../../image-io/psdProtocol';
import { createDefaultAdjustments } from '../../types';
import {
  createAdjustmentStackFromBasicAdjustments
} from '../../processing/adjustmentStack';
import {
  selectAdjustmentLayerModules,
  type AdjustmentLayerKind
} from '../../processing/adjustmentLayerCatalog';
import {
  createDefaultPhotoshopAdjustment,
  type PhotoshopAdjustmentKind,
  type PhotoshopAdjustmentSettings
} from '../../photoshopAdjustments';
import type { CurvePoint } from '../../curves';
import { createDefaultLayerStyleStack } from '../styles/layerStyleDefaults';
import {
  convertEncodedDocumentColorToSrgb,
  documentBlendProfileFromIccName
} from '../color/documentColorTransform';
import type { DocumentBlendProfile } from '../document/documentTypes';
import { parseCubeLut } from '../../processing/colorLookupCube';

export interface PsdDocumentImport {
  document: ImageDocument;
  assets: DocumentAssetBlob[];
  warnings: string[];
  compatibility: PsdImportCompatibilityEntry[];
}

export type PsdImportSupport = PhotoshopImportSupport;
export type PsdImportCompatibilityEntry = PhotoshopImportCompatibilityEntry;

type AdaptedLayer = LayerNode | LayerNode[] | null;
const adaptedLayers = (value: AdaptedLayer): LayerNode[] =>
  value === null ? [] : Array.isArray(value) ? value : [value];

const BLEND_MODE_MAP: Record<string, BlendMode | undefined> = {
  normal: 'normal',
  darken: 'darken',
  multiply: 'multiply',
  'color burn': 'color-burn',
  'linear burn': 'linear-burn',
  'darker color': 'darker-color',
  lighten: 'lighten',
  screen: 'screen',
  'color dodge': 'color-dodge',
  'linear dodge': 'linear-dodge',
  'lighter color': 'lighter-color',
  overlay: 'overlay',
  'soft light': 'soft-light',
  'hard light': 'hard-light',
  'vivid light': 'vivid-light',
  'linear light': 'linear-light',
  'pin light': 'pin-light',
  'hard mix': 'hard-mix',
  difference: 'difference',
  exclusion: 'exclusion',
  subtract: 'subtract',
  subtraction: 'subtract',
  divide: 'divide',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity'
};

const mapBlendMode = (
  source: string,
  warnings: string[],
  compatibility: PsdImportCompatibilityEntry[],
  path: string
) => {
  const mapped = BLEND_MODE_MAP[source];
  if (mapped && BLEND_MODES.some(({ id }) => id === mapped)) {
    compatibility.push({
      path,
      feature: 'blend-mode',
      support: 'native',
      reason: `Photoshop ${source} maps to LightTable ${mapped}.`
    });
    return mapped;
  }
  if (source !== 'pass through') {
    warnings.push(`${path}: Photoshop blend mode "${source}" is preserved but currently renders as Normal.`);
    compatibility.push({
      path,
      feature: 'blend-mode',
      support: 'preserved',
      reason: `Photoshop ${source} is preserved but currently renders as Normal.`
    });
  }
  return 'normal';
};

const mapCurve = (points: CurvesAdjustmentChannel | undefined): CurvePoint[] | null => {
  if (!points?.length) return null;
  const maximum = points.reduce(
    (value, point) => Math.max(value, point.input, point.output),
    255
  );
  const scale = maximum > 255 ? 65_535 : 255;
  return points.map(({ input, output }) => ({
    x: Math.max(0, Math.min(1, input / scale)),
    y: Math.max(0, Math.min(1, output / scale))
  }));
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const levelsCurve = (channel: LevelsAdjustmentChannel | undefined): CurvePoint[] | null => {
  if (!channel) return null;
  const inputBlack = clamp(channel.shadowInput / 255, 0, 1);
  const inputWhite = clamp(channel.highlightInput / 255, inputBlack + 1e-6, 1);
  const outputBlack = clamp(channel.shadowOutput / 255, 0, 1);
  const outputWhite = clamp(channel.highlightOutput / 255, 0, 1);
  const gamma = clamp(channel.midtoneInput || 1, 0.01, 9.99);
  return Array.from({ length: 33 }, (_, index) => {
    const x = index / 32;
    const normalized = clamp((x - inputBlack) / (inputWhite - inputBlack), 0, 1);
    return {
      x,
      y: outputBlack + (outputWhite - outputBlack) * normalized ** (1 / gamma)
    };
  });
};

const rgbColor = (value: PsdColor | undefined, sourceProfile: DocumentBlendProfile) => {
  if (!value) return null;
  if ('r' in value && 'g' in value && 'b' in value) {
    const divisor = Math.max(value.r, value.g, value.b) > 1 ? 255 : 1;
    const converted = convertEncodedDocumentColorToSrgb({
      r: clamp(value.r / divisor, 0, 1),
      g: clamp(value.g / divisor, 0, 1),
      b: clamp(value.b / divisor, 0, 1)
    }, sourceProfile);
    return { red: converted.r, green: converted.g, blue: converted.b };
  }
  if ('fr' in value && 'fg' in value && 'fb' in value) {
    const converted = convertEncodedDocumentColorToSrgb({
      r: clamp(value.fr, 0, 1), g: clamp(value.fg, 0, 1), b: clamp(value.fb, 0, 1)
    }, sourceProfile);
    return { red: converted.r, green: converted.g, blue: converted.b };
  }
  if ('l' in value && 'a' in value && 'b' in value) {
    // PSD Photo Filter descriptors commonly canonicalize their authored RGB
    // color to normalized CIE Lab. ag-psd exposes L as 0..1 and a/b as signed
    // 16-bit Lab fractions (positive / 127, negative / 128).
    const lightness = value.l * 100;
    const labA = value.a * (value.a < 0 ? 128 : 127);
    const labB = value.b * (value.b < 0 ? 128 : 127);
    const fy = (lightness + 16) / 116;
    const fx = fy + labA / 500;
    const fz = fy - labB / 200;
    const delta = 6 / 29;
    const inverseLab = (component: number) => component > delta
      ? component ** 3
      : 3 * delta ** 2 * (component - 4 / 29);
    const x50 = 0.96422 * inverseLab(fx);
    const y50 = inverseLab(fy);
    const z50 = 0.82521 * inverseLab(fz);
    const x = 0.9555766 * x50 - 0.0230393 * y50 + 0.0631636 * z50;
    const y = -0.0282895 * x50 + 1.0099416 * y50 + 0.0210077 * z50;
    const z = 0.0122982 * x50 - 0.020483 * y50 + 1.3299098 * z50;
    const encode = (component: number) => component <= 0.0031308
      ? component * 12.92
      : 1.055 * Math.max(component, 0) ** (1 / 2.4) - 0.055;
    return {
      red: clamp(encode(3.2404542 * x - 1.5371385 * y - 0.4985314 * z), 0, 1),
      green: clamp(encode(-0.969266 * x + 1.8760108 * y + 0.041556 * z), 0, 1),
      blue: clamp(encode(0.0556434 * x - 0.2040259 * y + 1.0572252 * z), 0, 1)
    };
  }
  return null;
};

const rgbToHueSaturation = (red: number, green: number, blue: number) => {
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  let hue = 0;
  if (delta > 1e-6) {
    if (maximum === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (maximum === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  return {
    hue: (hue + 360) % 360,
    saturation: maximum <= 1e-6 ? 0 : delta / maximum
  };
};

const photoshopKindForDescriptor = (
  source: PsdAdjustment | null
): AdjustmentLayerKind | null => {
  if (!source) return null;
  if (source.type === 'vibrance') {
    const modern = source as typeof source & {
      temperature?: number;
      tint?: number;
      useLegacy?: boolean;
    };
    if (modern.useLegacy === false || modern.temperature !== undefined || modern.tint !== undefined) {
      return 'color-vibrance';
    }
  }
  return ({
    'brightness/contrast': 'brightness-contrast',
    levels: 'levels',
    curves: 'curves',
    exposure: 'exposure',
    vibrance: 'vibrance',
    'hue/saturation': 'hue-saturation',
    'color balance': 'color-balance',
    'black & white': 'black-white',
    'photo filter': 'photo-filter',
    'channel mixer': 'channel-mixer',
    'color lookup': 'color-lookup',
    invert: 'invert',
    posterize: 'posterize',
    threshold: 'threshold',
    'gradient map': 'gradient-map',
    'selective color': 'selective-color'
  } as Partial<Record<PsdAdjustment['type'], AdjustmentLayerKind>>)[source.type] ?? null;
};

interface ImportedPhotoshopSettings {
  readonly kind: PhotoshopAdjustmentKind;
  readonly settings: PhotoshopAdjustmentSettings;
  readonly support: PsdImportSupport;
  readonly reason: string;
  readonly warning?: string;
}

const importedPhotoshopSettings = (
  source: PsdAdjustment,
  sourceProfile: DocumentBlendProfile,
  registerColorLookup: (name: string, data: Uint8Array) => DocumentAssetId
): ImportedPhotoshopSettings | null => {
  const result = (kind: PhotoshopAdjustmentKind) =>
    createDefaultPhotoshopAdjustment(kind);
  switch (source.type) {
    case 'brightness/contrast': {
      const settings = result('brightness-contrast');
      settings.brightness = source.brightness ?? 0;
      settings.contrast = source.contrast ?? 0;
      settings.useLegacyBrightnessContrast = source.useLegacy ?? false;
      return { kind: settings.kind, settings, support: 'native', reason: 'Brightness / Contrast is mapped to its native LightTable adjustment node.' };
    }
    case 'levels': {
      const channels = [
        ['rgb', source.rgb], ['red', source.red], ['green', source.green], ['blue', source.blue]
      ] as const;
      const authored = channels.filter(([, value]) => Boolean(value));
      if (!authored.length) return null;
      const settings = result('levels');
      for (const [channel, value] of authored) {
        if (!value) continue;
        settings.levels[channel] = {
          input: [value.shadowInput, value.midtoneInput, value.highlightInput],
          output: [value.shadowOutput, value.highlightOutput]
        };
      }
      const nonNeutral = authored.find(([, value]) => value && (
        value.shadowInput !== 0 || value.midtoneInput !== 1 || value.highlightInput !== 255
        || value.shadowOutput !== 0 || value.highlightOutput !== 255
      ));
      settings.levelsChannel = nonNeutral?.[0] ?? authored[0]![0];
      return {
        kind: settings.kind, settings,
        support: 'native',
        reason: 'Photoshop composite and per-channel Levels are mapped to the native channel-aware LightTable Levels node.'
      };
    }
    case 'exposure': {
      const settings = result('exposure');
      settings.exposure = source.exposure ?? 0;
      settings.exposureOffset = source.offset ?? 0;
      settings.exposureGamma = source.gamma ?? 1;
      return { kind: settings.kind, settings, support: 'native', reason: 'Exposure, Offset and Gamma are mapped to the native LightTable Exposure node.' };
    }
    case 'vibrance': {
      const modern = source as typeof source & {
        temperature?: number;
        tint?: number;
        useLegacy?: boolean;
      };
      if (modern.useLegacy === false || modern.temperature !== undefined || modern.tint !== undefined) {
        const settings = result('color-vibrance');
        settings.colorVibranceTemperature = modern.temperature ?? 0;
        settings.colorVibranceTint = modern.tint ?? 0;
        settings.colorVibranceVibrance = source.vibrance ?? 0;
        settings.colorVibranceSaturation = source.saturation ?? 0;
        return {
          kind: settings.kind,
          settings,
          support: 'native',
          reason: 'Photoshop 27 Color and Vibrance is mapped to its coupled measured LightTable node.'
        };
      }
      const settings = result('vibrance');
      settings.vibrance = source.vibrance ?? 0;
      settings.vibranceSaturation = source.saturation ?? 0;
      return {
        kind: settings.kind,
        settings,
        support: 'native',
        reason: 'Photoshop Vibrance and Saturation are mapped to the measured native LightTable node.'
      };
    }
    case 'hue/saturation': {
      const settings = result('hue-saturation');
      const master = source.master;
      if (master) {
        settings.colorize = master.a === 256;
        settings.hue = settings.colorize ? (master.b + 360) % 360 : master.hue;
        settings.hueSaturation = settings.colorize ? master.c : master.saturation;
        settings.hueLightness = settings.colorize ? master.d : master.lightness;
      }
      const rangeChannels = ['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas'] as const;
      for (const channel of rangeChannels) {
        const range = source[channel];
        if (!range) continue;
        settings.hueSaturationRanges[channel] = {
          boundaries: [range.a, range.b, range.c, range.d],
          hue: range.hue,
          saturation: range.saturation,
          lightness: range.lightness
        };
      }
      const authoredRange = rangeChannels.find((channel) => {
        const range = settings.hueSaturationRanges[channel];
        return range.hue !== 0 || range.saturation !== 0 || range.lightness !== 0;
      });
      const hasRanges = Boolean(authoredRange);
      settings.hueSaturationChannel = authoredRange ?? 'master';
      return {
        kind: settings.kind, settings,
        support: 'native',
        reason: hasRanges
          ? 'Photoshop master and color-range Hue / Saturation settings are mapped to the native LightTable node.'
          : 'Photoshop master Hue / Saturation is mapped to the native LightTable node.'
      };
    }
    case 'color balance': {
      const settings = result('color-balance');
      const values = (entry: typeof source.shadows) => [
        entry?.cyanRed ?? 0, entry?.magentaGreen ?? 0, entry?.yellowBlue ?? 0
      ] as [number, number, number];
      settings.colorBalanceShadows = values(source.shadows);
      settings.colorBalanceMidtones = values(source.midtones);
      settings.colorBalanceHighlights = values(source.highlights);
      settings.preserveLuminosity = source.preserveLuminosity ?? true;
      return { kind: settings.kind, settings, support: 'native', reason: 'Photoshop Color Balance zones are mapped to the native LightTable node.' };
    }
    case 'black & white': {
      const settings = result('black-white');
      settings.blackWhiteMix = [source.reds ?? 40, source.yellows ?? 60, source.greens ?? 40,
        source.cyans ?? 60, source.blues ?? 20, source.magentas ?? 80];
      settings.blackWhiteTint = source.useTint ?? false;
      const tint = rgbColor(source.tintColor, sourceProfile);
      if (tint) settings.blackWhiteTintColor = { r: tint.red, g: tint.green, b: tint.blue, a: 1 };
      return { kind: settings.kind, settings, support: 'native', reason: 'Photoshop Black & White channel weights and tint are mapped to the native LightTable node.' };
    }
    case 'photo filter': {
      const settings = result('photo-filter');
      const filter = rgbColor(source.color, sourceProfile);
      if (filter) settings.photoFilterColor = { r: filter.red, g: filter.green, b: filter.blue, a: 1 };
      const density = source.density ?? 0.25;
      settings.photoFilterDensity = density <= 1 ? density * 100 : density;
      settings.preserveLuminosity = source.preserveLuminosity ?? true;
      return { kind: settings.kind, settings, support: 'native', reason: 'Photoshop Photo Filter is mapped to the native LightTable node.' };
    }
    case 'channel mixer': {
      const settings = result('channel-mixer');
      const values = (entry: typeof source.red) => [entry?.red ?? 0, entry?.green ?? 0,
        entry?.blue ?? 0, entry?.constant ?? 0] as [number, number, number, number];
      settings.channelMixerMonochrome = source.monochrome ?? false;
      settings.channelMixerRed = values(source.monochrome ? source.gray : source.red);
      settings.channelMixerGreen = values(source.green);
      settings.channelMixerBlue = values(source.blue);
      return { kind: settings.kind, settings, support: 'native', reason: 'Photoshop Channel Mixer channels are mapped to the native LightTable node.' };
    }
    case 'color lookup': {
      const settings = result('color-lookup');
      const file = source.lut3DFileName?.toLowerCase() ?? '';
      settings.colorLookupPreset = file.endsWith('lighttable-film-stock.cube') ? 'film-stock'
        : file.endsWith('lighttable-moonlight.cube') ? 'moonlight'
          : file.endsWith('lighttable-teal-orange.cube') ? 'teal-orange' : 'none';
      if (settings.colorLookupPreset === 'none' && source.lut3DFileData) {
        try {
          settings.colorLookupAssetId = registerColorLookup(
            source.lut3DFileName || 'Photoshop Color Lookup.cube',
            source.lut3DFileData
          );
          return {
            kind: settings.kind,
            settings,
            support: 'native',
            reason: 'The embedded Photoshop .cube LUT is restored as an editable native Color Lookup asset.'
          };
        } catch (error) {
          return {
            kind: settings.kind,
            settings,
            support: 'preserved',
            reason: 'The embedded Photoshop Color Lookup descriptor is preserved but its LUT could not be decoded.',
            warning: error instanceof Error ? error.message : 'The embedded .cube LUT is invalid.'
          };
        }
      }
      const native = settings.colorLookupPreset !== 'none' || !source.lut3DFileData;
      return {
        kind: settings.kind, settings,
        support: native ? 'native' : 'preserved',
        reason: native
          ? 'The embedded LightTable Color Lookup preset is restored as an editable native node.'
          : 'The external Photoshop Color Lookup descriptor is preserved; arbitrary LUT assets are not editable yet.',
        ...(!native ? { warning: 'An external Photoshop Color Lookup LUT remains preserved and currently renders as a no-op.' } : {})
      };
    }
    case 'selective color': {
      const settings = result('selective-color');
      const ranges = [source.reds, source.yellows, source.greens, source.cyans, source.blues,
        source.magentas, source.whites, source.neutrals, source.blacks];
      settings.selectiveColorValues = ranges.flatMap((entry) => [
        entry?.c ?? 0, entry?.m ?? 0, entry?.y ?? 0, entry?.k ?? 0
      ]);
      settings.selectiveColorMethod = source.mode ?? 'relative';
      return { kind: settings.kind, settings, support: 'native', reason: 'Photoshop Selective Color ranges are mapped to the native LightTable node.' };
    }
    case 'invert': return { kind: 'invert', settings: result('invert'), support: 'native', reason: 'Photoshop Invert is mapped to the native LightTable node.' };
    case 'posterize': {
      const settings = result('posterize'); settings.posterizeLevels = source.levels ?? 4;
      return { kind: settings.kind, settings, support: 'native', reason: 'Photoshop Posterize is mapped to the native LightTable node.' };
    }
    case 'threshold': {
      const settings = result('threshold'); settings.thresholdLevel = source.level ?? 128;
      return { kind: settings.kind, settings, support: 'native', reason: 'Photoshop Threshold is mapped to the native LightTable node.' };
    }
    default: return null;
  }
};

const importPsdAdjustment = (
  descriptor: unknown,
  warnings: string[],
  compatibility: PsdImportCompatibilityEntry[],
  path: string,
  sourceProfile: DocumentBlendProfile = 'srgb',
  registerColorLookup: (name: string, data: Uint8Array) => DocumentAssetId = () => {
    throw new Error('Embedded Color Lookup assets are unavailable in this import context.');
  }
) => {
  const adjustments = createDefaultAdjustments();
  const source = descriptor as PsdAdjustment | null;
  if (!source?.type) {
    warnings.push(`${path}: adjustment descriptor is missing; imported as a disabled visual no-op.`);
    compatibility.push({
      path,
      feature: 'adjustment',
      support: 'preserved',
      reason: 'The adjustment descriptor is missing and renders as a no-op.'
    });
    return createAdjustmentStackFromBasicAdjustments(adjustments);
  }
  const nativePhotoshop = importedPhotoshopSettings(
    source,
    sourceProfile,
    registerColorLookup
  );
  if (nativePhotoshop) {
    adjustments.photoshopAdjustment = nativePhotoshop.settings;
    if (nativePhotoshop.warning) {
      warnings.push(`${path}: ${nativePhotoshop.warning}`);
    }
    compatibility.push({
      path,
      feature: 'adjustment',
      support: nativePhotoshop.support,
      reason: nativePhotoshop.reason
    });
    return selectAdjustmentLayerModules(
      createAdjustmentStackFromBasicAdjustments(adjustments),
      nativePhotoshop.kind
    );
  }
  let support: PsdImportSupport = 'native';
  let supportReason = `Photoshop ${source.type} is mapped to a native LightTable adjustment.`;
  switch (source.type) {
    case 'exposure':
      adjustments.exposureEV = source.exposure ?? 0;
      if ((source.offset ?? 0) !== 0 || (source.gamma ?? 1) !== 1) {
        support = 'approximate';
        supportReason = 'Exposure EV is native; Photoshop offset/gamma are preserved but not evaluated.';
        warnings.push(`${path}: Photoshop Exposure offset/gamma are preserved in the PSD inventory but not evaluated yet.`);
      }
      break;
    case 'brightness/contrast':
      adjustments.exposureEV = (source.brightness ?? 0) / 100;
      adjustments.contrast = source.contrast ?? 0;
      warnings.push(`${path}: Photoshop Brightness is provisionally mapped to LightTable Exposure pending a golden-fixture transfer curve.`);
      support = 'approximate';
      supportReason = 'Brightness is provisionally mapped to Exposure; Contrast is native.';
      break;
    case 'hue/saturation': {
      const master = source.master;
      if (master) {
        adjustments.colorMixer.hue.fill(master.hue);
        adjustments.saturation = master.saturation;
        if (master.lightness !== 0) {
          adjustments.colorMixer.luminance.fill(master.lightness);
        }
      }
      const channels = [
        source.reds,
        source.reds,
        source.yellows,
        source.greens,
        source.cyans,
        source.blues,
        source.magentas,
        source.magentas
      ];
      channels.forEach((channel, index) => {
        if (!channel) return;
        adjustments.colorMixer.hue[index] += channel.hue;
        adjustments.colorMixer.saturation[index] += channel.saturation;
        adjustments.colorMixer.luminance[index] += channel.lightness;
      });
      warnings.push(`${path}: Photoshop Hue/Saturation range boundaries are mapped to LightTable's smooth perceptual mixer and may differ at range overlaps.`);
      support = 'approximate';
      supportReason = 'Hue/Saturation is editable through the perceptual mixer with different range falloff.';
      break;
    }
    case 'curves': {
      adjustments.curves.interpolation = 'photoshop-natural';
      adjustments.curves.master = mapCurve(source.rgb) ?? adjustments.curves.master;
      adjustments.curves.red = mapCurve(source.red) ?? adjustments.curves.red;
      adjustments.curves.green = mapCurve(source.green) ?? adjustments.curves.green;
      adjustments.curves.blue = mapCurve(source.blue) ?? adjustments.curves.blue;
      break;
    }
    case 'levels':
      adjustments.curves.master = levelsCurve(source.rgb) ?? adjustments.curves.master;
      adjustments.curves.red = levelsCurve(source.red) ?? adjustments.curves.red;
      adjustments.curves.green = levelsCurve(source.green) ?? adjustments.curves.green;
      adjustments.curves.blue = levelsCurve(source.blue) ?? adjustments.curves.blue;
      break;
    case 'invert':
      adjustments.curves.master = [{ x: 0, y: 1 }, { x: 1, y: 0 }];
      break;
    case 'black & white':
      adjustments.saturation = -100;
      if (source.useTint) {
        const tint = rgbColor(source.tintColor, sourceProfile);
        if (tint) {
          const mapped = rgbToHueSaturation(tint.red, tint.green, tint.blue);
          adjustments.colorGrading.hue[0] = mapped.hue;
          adjustments.colorGrading.saturation[0] = mapped.saturation * 100;
        }
      }
      warnings.push(`${path}: Photoshop Black & White channel weights are preserved; the current native mapping uses perceptual grayscale${source.useTint ? ' plus tint' : ''}.`);
      support = 'approximate';
      supportReason = 'Black & White is editable, but Photoshop channel weights are not evaluated yet.';
      break;
    case 'color balance': {
      const zones = [
        { source: source.shadows, target: 1 },
        { source: source.midtones, target: 2 },
        { source: source.highlights, target: 3 }
      ] as const;
      zones.forEach(({ source: values, target }) => {
        if (!values) return;
        const red = values.cyanRed / 100;
        const green = values.magentaGreen / 100;
        const blue = values.yellowBlue / 100;
        const neutral = Math.min(red, green, blue);
        const mapped = rgbToHueSaturation(red - neutral, green - neutral, blue - neutral);
        adjustments.colorGrading.hue[target] = mapped.hue;
        adjustments.colorGrading.saturation[target] = clamp(
          Math.hypot(red, green, blue) * 70,
          0,
          100
        );
      });
      warnings.push(`${path}: Photoshop Color Balance is mapped to LightTable tonal grading wheels; preserve-luminosity and transfer curves require fixture calibration.`);
      support = 'approximate';
      supportReason = 'Color Balance is mapped to tonal grading wheels and needs transfer calibration.';
      break;
    }
    case 'photo filter': {
      const filterColor = rgbColor(source.color, sourceProfile);
      if (filterColor) {
        const mapped = rgbToHueSaturation(filterColor.red, filterColor.green, filterColor.blue);
        adjustments.colorGrading.hue[0] = mapped.hue;
        adjustments.colorGrading.saturation[0] = clamp(
          mapped.saturation * (source.density ?? 25),
          0,
          100
        );
      }
      warnings.push(`${path}: Photoshop Photo Filter is mapped to a global LightTable grading tint pending density/preserve-luminosity fixtures.`);
      support = 'approximate';
      supportReason = 'Photo Filter is mapped to global grading tint pending fixture calibration.';
      break;
    }
    case 'gradient map': {
      if (source.gradientType !== 'solid' || !source.colorStops?.length) {
        support = 'preserved';
        supportReason = 'Photoshop noise Gradient Maps remain preserved until the deterministic noise-gradient evaluator is available.';
        warnings.push(`${path}: Photoshop noise Gradient Map is preserved and currently renders as a no-op.`);
        break;
      }
      const colorStops = source.colorStops.flatMap((stop) => {
        const mapped = rgbColor(stop.color, sourceProfile);
        return mapped ? [{
          position: clamp(stop.location > 1 ? stop.location / 4096 : stop.location, 0, 1),
          midpoint: clamp(stop.midpoint > 1 ? stop.midpoint / 100 : stop.midpoint, 0.01, 0.99),
          color: { r: mapped.red, g: mapped.green, b: mapped.blue }
        }] : [];
      });
      if (colorStops.length < 2) {
        support = 'preserved';
        supportReason = 'Gradient Map colors could not be converted to the document RGB profile.';
        warnings.push(`${path}: Gradient Map colors could not be converted and the descriptor remains preserved.`);
        break;
      }
      adjustments.gradientMap = {
        enabled: true,
        reverse: source.reverse ?? false,
        dither: source.dither ?? false,
        // ag-psd reports its Perceptual fallback even when the PSD has no
        // explicit method key; Photoshop renders that legacy descriptor as Classic.
        interpolation: 'classic',
        photoshopCompatible: true,
        colorStops,
        // Photoshop retains gradient transparency metadata in a Gradient Map
        // descriptor but does not apply it to the adjustment output.
        opacityStops: ([
          { location: 0, midpoint: 50, opacity: 100 },
          { location: 4096, midpoint: 50, opacity: 100 }
        ]).map((stop) => ({
          position: clamp(stop.location > 1 ? stop.location / 4096 : stop.location, 0, 1),
          midpoint: clamp(stop.midpoint > 1 ? stop.midpoint / 100 : stop.midpoint, 0.01, 0.99),
          opacity: clamp(stop.opacity > 1 ? stop.opacity / 100 : stop.opacity, 0, 1)
        }))
      };
      if (source.method && source.method !== 'classic') {
        support = 'approximate';
        supportReason = `Solid Gradient Map is native; Photoshop ${source.method} interpolation is currently approximated by classic midpoint interpolation.`;
        warnings.push(`${path}: Gradient Map ${source.method} interpolation is approximated by classic midpoint interpolation.`);
      }
      break;
    }
    default:
      support = 'preserved';
      supportReason = `Photoshop ${source.type} is structurally preserved and currently renders as a no-op.`;
      warnings.push(`${path}: Photoshop ${source.type} adjustment is structurally imported but currently renders as a no-op.`);
  }
  compatibility.push({ path, feature: 'adjustment', support, reason: supportReason });
  return createAdjustmentStackFromBasicAdjustments(adjustments);
};

export const importPsdDocument = (
  source: PsdDecodeSuccess,
  name: string
): PsdDocumentImport => {
  const assets: DocumentAssetBlob[] = [];
  const colorLookups: ColorLookupAsset[] = [];
  const warnings = [...source.warnings];
  const compatibility: PsdImportCompatibilityEntry[] = [];
  const now = Date.now();
  const blendProfile = documentBlendProfileFromIccName(source.colorProfile.name);
  const patternIds = new Map(
    source.patterns.map((pattern) => [
      pattern.id,
      `psd-pattern-${pattern.id}` as DocumentAssetId
    ])
  );
  source.patterns.forEach((pattern) => {
    const patternId = patternIds.get(pattern.id)!;
    assets.push({ patternId, source: pattern.pixels });
  });
  const registerColorLookup = (fileName: string, data: Uint8Array): DocumentAssetId => {
    const parsed = parseCubeLut(new TextDecoder().decode(data));
    const id = `psd-lut-${crypto.randomUUID()}` as DocumentAssetId;
    const sourceBlob = new Blob([Uint8Array.from(data).buffer], { type: 'application/x-cube' });
    colorLookups.push({
      id,
      name: parsed.title || fileName,
      size: parsed.size,
      domainMin: parsed.domainMin,
      domainMax: parsed.domainMax,
      byteLength: sourceBlob.size,
      revision: 0
    });
    assets.push({ lutId: id, source: sourceBlob });
    return id;
  };
  const adapt = (node: PsdLayerNodeDto, path: string): AdaptedLayer => {
    const id = node.id as LayerId;
    if (node.pixelSummary && node.pixelSummary.nonTransparentPixels === 0) {
      warnings.push(
        `${path}: Photoshop supplied raster pixels for "${node.name}", but their alpha channel is completely transparent `
        + `(${node.pixelSummary.width} x ${node.pixelSummary.height}).`
      );
      compatibility.push({
        path,
        feature: 'node',
        support: 'placeholder',
        reason: 'The decoded layer-local raster preview contains no visible pixels.'
      });
    }
    const styleImport = importPsdLayerStyles(node.effects as LayerEffectsInfo | undefined, {
      resolvePatternAsset: (patternId) => patternIds.get(patternId) ?? null,
      sourceProfile: blendProfile
    });
    styleImport.compatibility
      .forEach(({ support, reason, path: effectPath }) => {
        compatibility.push({
          path: `${path}.${effectPath}`,
          feature: 'layer-style',
          support: support === 'editable'
            ? 'native'
            : support === 'rasterized' ? 'raster-preview' : 'preserved',
          reason
        });
        if (support !== 'editable') warnings.push(`${path}.${effectPath}: ${reason}`);
      });
    if (node.mask && (
      Math.abs(node.mask.density - 1) > 0.00001
      || Math.abs(node.mask.feather) > 0.00001
    )) {
      warnings.push(
        `${path}: mask density (${node.mask.density}) and feather (${node.mask.feather}) are rendered; Photoshop fixture calibration is still pending.`
      );
      compatibility.push({
        path,
        feature: 'mask',
        support: 'approximate',
        reason: 'Bitmap mask density and feather are evaluated natively; Photoshop fixture calibration is pending.'
      });
    } else if (node.mask) {
      compatibility.push({
        path,
        feature: 'mask',
        support: node.mask.source === 'real-mask' ? 'raster-preview' : 'native',
        reason: node.mask.source === 'real-mask'
          ? 'Photoshop real/vector mask pixels are mapped to a native raster mask; the vector path remains preserved.'
          : 'Bitmap mask is mapped to a native LightTable mask.'
      });
    }
    if (node.kind !== 'vector' && node.preserved.vectorMask) {
      const simultaneous = Boolean(node.mask);
      compatibility.push({
        path,
        feature: 'mask',
        support: simultaneous ? 'preserved' : 'native',
        reason: simultaneous
          ? 'Raster mask pixels and Photoshop vector-mask geometry remain separate operands; the rasterized combined result is used only as the current visual cache.'
          : 'Photoshop vector-mask geometry is retained independently from raster mask pixels.'
      });
      if (simultaneous) warnings.push(
        `${path}: raster and vector masks are retained separately; the compatibility report records that the combined raster cache is not editable vector authority.`
      );
    }
    const common = {
      id,
      name: node.name,
      visible: node.visible,
      locks: {
        ...createDefaultLayerLocks(),
        transparency: node.transparencyProtected
      },
      opacity: node.opacity,
      fillOpacity: node.fillOpacity,
      blendMode: mapBlendMode(node.blendMode, warnings, compatibility, path),
      clipping: node.clipping,
      styleStack: styleImport.stack,
      transform: identityAffineMatrix(),
      revision: 0,
      geometryRevision: 0,
      createdAt: now,
      modifiedAt: now,
      photoshop: {
        sourceKind: node.kind,
        sourceBlendMode: node.blendMode,
        bounds: {
          x: node.bounds.left,
          y: node.bounds.top,
          width: Math.max(0, node.bounds.right - node.bounds.left),
          height: Math.max(0, node.bounds.bottom - node.bounds.top)
        },
        mask: node.mask ? {
          defaultColor: node.mask.defaultColor,
          density: node.mask.density,
          feather: node.mask.feather
        } : null,
        effects: node.effects,
        adjustment: node.adjustment,
        preserved: node.preserved
      }
    };
    if (node.kind === 'group') {
      compatibility.push({
        path,
        feature: 'node',
        support: 'native',
        reason: 'Photoshop group is mapped to a native ordered LightTable group.'
      });
      return {
        ...common,
        type: 'group',
        compositing: node.blendMode === 'pass through' ? 'pass-through' : 'isolated',
        vectorClip: null,
        mask: node.mask ? {
          id: node.mask.id,
          enabled: node.mask.enabled,
          linked: true,
          transform: identityAffineMatrix(),
          density: node.mask.density,
          feather: node.mask.feather,
          revision: 0,
          pixelRevision: 0,
          dirtyBounds: null
        } : null,
        children: adaptSiblings(node.children, `${path}.children`)
      };
    }
    if (node.kind === 'adjustment') {
      const adjustmentKind = photoshopKindForDescriptor(node.adjustment as PsdAdjustment | null);
      const layer: AdjustmentLayer = {
        ...common,
        type: 'adjustment',
        adjustmentKind,
        adjustmentStack: importPsdAdjustment(
          node.adjustment,
          warnings,
          compatibility,
          path,
          blendProfile,
          registerColorLookup
        ),
        mask: node.mask ? {
          id: node.mask.id,
          enabled: node.mask.enabled,
          linked: true,
          transform: identityAffineMatrix(),
          density: node.mask.density,
          feather: node.mask.feather,
          revision: 0,
          pixelRevision: 0,
          dirtyBounds: null
        } : null
      };
      if (node.mask) {
        assets.push({ layerId: id, pixels: new Blob(), mask: node.mask.pixels });
      }
      compatibility.push({
        path,
        feature: 'node',
        support: 'native',
        reason: 'Photoshop Adjustment Layer is mapped to a native LightTable Adjustment Layer.'
      });
      return layer;
    }
    if (node.kind === 'vector') {
      const vectorImport = importPsdVectorShape({
        sourceObjectId: node.id,
        name: node.name,
        vectorFill: node.preserved.vectorFill,
        vectorMask: node.preserved.vectorMask,
        vectorStroke: node.preserved.vectorStroke
      }, blendProfile);
      if (vectorImport.status === 'native'
        || (vectorImport.status === 'preview-backed' && node.pixels && node.pixelSummary)) {
        let layer: VectorLayer = {
          ...common,
          type: 'vector',
          antiAlias: true,
          elements: vectorImport.elements,
          vectorClip: null,
          mask: node.mask ? {
            id: node.mask.id,
            enabled: node.mask.enabled,
            linked: true,
            transform: identityAffineMatrix(),
            density: node.mask.density,
            feather: node.mask.feather,
            revision: 0,
            pixelRevision: 0,
            dirtyBounds: null
          } : null
        };
        if (vectorImport.status === 'preview-backed' && node.pixels && node.pixelSummary) {
          const dependencyKey = semanticLayerDependencyKey(layer);
          if (!dependencyKey) throw new Error(`Vector layer ${node.name} has no semantic dependency key.`);
          layer = {
            ...layer,
            derivedPreview: {
              width: node.pixelSummary.width,
              height: node.pixelSummary.height,
              transform: translationMatrix(node.bounds.left, node.bounds.top),
              dependencyKey,
              source: 'photoshop-layer-preview'
            }
          };
          assets.push({ layerId: id, pixels: node.pixels, mask: node.mask?.pixels ?? null });
        } else if (node.mask) {
          assets.push({ layerId: id, pixels: new Blob(), mask: node.mask.pixels });
        }
        compatibility.push({
          path,
          feature: 'node',
          support: vectorImport.status === 'native' ? 'native' : 'approximate',
          reason: vectorImport.reason,
          layerId: id,
          editable: true,
          parity: vectorImport.status === 'native' ? undefined : {
            visual: 'raster-preview',
            semantic: 'editable',
            structural: 'native',
            roundTrip: 'preserved'
          }
        });
        return layer;
      }
      warnings.push(`${path}: ${vectorImport.reason}`);
      compatibility.push({
        path,
        feature: 'node',
        support: node.pixels ? 'raster-preview' : 'preserved',
        reason: node.pixels
          ? `${vectorImport.reason} Photoshop's layer-local raster preview remains visible.`
          : vectorImport.reason
      });
    }
    if (node.kind === 'text') {
      const pathLayerId = `${node.id}-text-path` as LayerId;
      const pathElementId = `${node.id}-text-path-element`;
      const pathSubpathId = `${node.id}-text-path-subpath`;
      const textImport = importPsdText(node.preserved.text, node.id, {
        layerId: pathLayerId,
        elementId: pathElementId,
        subpathId: pathSubpathId
      }, blendProfile);
      const reason = textImport.reasons.join(' ');
      const previewBacked = node.rasterFallback !== 'transparent-placeholder' && Boolean(node.pixels);
      if (textImport.kind === 'editable-flow') {
        let layer: TextLayer = {
          ...common,
          type: 'text',
          transform: textImport.transform,
          text: textImport.text,
          mask: node.mask ? {
            id: node.mask.id,
            enabled: node.mask.enabled,
            linked: true,
            transform: identityAffineMatrix(),
            density: node.mask.density,
            feather: node.mask.feather,
            revision: 0,
            pixelRevision: 0,
            dirtyBounds: null
          } : null
        };
        if (previewBacked && node.pixels && node.pixelSummary) {
          const dependencyKey = semanticLayerDependencyKey(layer);
          if (!dependencyKey) throw new Error(`Text layer ${node.name} has no semantic dependency key.`);
          layer = {
            ...layer,
            derivedPreview: {
              width: node.pixelSummary.width,
              height: node.pixelSummary.height,
              transform: translationMatrix(node.bounds.left, node.bounds.top),
              dependencyKey,
              source: 'photoshop-layer-preview'
            }
          };
          assets.push({ layerId: id, pixels: node.pixels, mask: node.mask?.pixels ?? null });
        } else if (node.mask) {
          assets.push({ layerId: id, pixels: new Blob(), mask: node.mask.pixels });
        }
        compatibility.push({
          path,
          feature: 'text',
          support: 'approximate',
          reason,
          layerId: id,
          editable: true,
          parity: {
            visual: 'approximate',
            semantic: 'editable',
            structural: 'native',
            roundTrip: 'unsupported'
          }
        });
        compatibility.push({
          path,
          feature: 'node',
          support: 'approximate',
          reason: previewBacked
            ? 'Supported Photoshop text is mapped to native editable flow text; the retained Photoshop composite remains available as the visual reference.'
            : 'Photoshop text without a usable raster preview is mapped to native editable flow text.'
        });
        warnings.push(`${path}: ${reason}${previewBacked
          ? ' The native editable layer is authoritative; compare it with the retained Photoshop composite when fonts differ.'
          : ''}`);
        if (!textImport.path) return layer;
        const pathLayer: VectorLayer = {
          id: pathLayerId,
          type: 'vector',
          name: `${node.name} Path`,
          visible: false,
          locks: createDefaultLayerLocks(),
          opacity: 1,
          fillOpacity: 1,
          blendMode: 'normal',
          clipping: false,
          styleStack: createDefaultLayerStyleStack(),
          transform: textImport.transform,
          revision: 0,
          geometryRevision: 0,
          createdAt: now,
          modifiedAt: now,
          antiAlias: true,
          elements: [textImport.path],
          vectorClip: null,
          mask: null
        };
        return [pathLayer, layer];
      }
      compatibility.push({
        path,
        feature: 'text',
        support: previewBacked ? 'raster-preview' : 'preserved',
        layerId: id,
        editable: false,
        parity: {
          visual: previewBacked ? 'raster-preview' : 'missing',
          semantic: 'preserved',
          structural: 'preserved',
          roundTrip: 'preserved'
        },
        reason
      });
    }
    if (!node.pixels) {
      warnings.push(`${path}: ${node.kind} "${node.name}" has no raster preview and is preserved in the PSD inventory but is not rendered yet.`);
      return null;
    }
    const layer: RasterLayer = {
      ...common,
      type: 'raster',
      transform: node.pixelSummary
        ? translationMatrix(node.bounds.left, node.bounds.top)
        : identityAffineMatrix(),
      pixelRevision: 0,
      width: node.pixelSummary?.width ?? source.width,
      height: node.pixelSummary?.height ?? source.height,
      offsetX: 0,
      offsetY: 0,
      pixelSource: { kind: 'runtime-raster', runtimeId: node.id },
      adjustmentStack: null,
      dirtyBounds: null,
      mask: node.mask ? {
        id: node.mask.id,
        enabled: node.mask.enabled,
        linked: true,
        transform: identityAffineMatrix(),
        density: node.mask.density,
        feather: node.mask.feather,
        revision: 0,
        pixelRevision: 0,
        dirtyBounds: null
      } : null
    };
    assets.push({ layerId: id, pixels: node.pixels, mask: node.mask?.pixels ?? null });
    if (node.kind !== 'raster' && node.kind !== 'vector') {
      compatibility.push({
        path,
        feature: 'node',
        support: node.rasterFallback === 'transparent-placeholder'
          ? 'placeholder'
          : 'raster-preview',
        reason: node.rasterFallback === 'transparent-placeholder'
          ? `${node.kind} semantics are preserved but no local preview was supplied.`
          : `${node.kind} semantics are preserved and currently render through the layer-local preview.`
      });
      warnings.push(node.rasterFallback === 'transparent-placeholder'
        ? `${path}: ${node.kind} "${node.name}" is structurally preserved, but Photoshop supplied no local raster preview; it is currently transparent until a native renderer is available.`
        : `${path}: ${node.kind} "${node.name}" currently imports as its layer-local raster preview.`);
    } else {
      compatibility.push({
        path,
        feature: 'node',
        support: 'native',
        reason: 'Photoshop raster layer is mapped to a native LightTable raster layer.'
      });
    }
    return layer;
  };

  function adaptSiblings(nodes: readonly PsdLayerNodeDto[], path: string): LayerNode[] {
    const layers: LayerNode[] = [];
    nodes.forEach((node, index) => {
      const adapted = adaptedLayers(adapt(node, `${path}[${index}]`));
      const adjustment = adapted.length === 1 && adapted[0]?.type === 'adjustment'
        ? adapted[0] : null;
      const base = layers.at(-1);
      const canAttach = Boolean(
        adjustment
        && adjustment.adjustmentKind
        && node.clipping
        && !node.mask
        && node.blendMode === 'normal'
        && Math.abs(node.opacity - 1) < 0.00001
        && Math.abs(node.fillOpacity - 1) < 0.00001
        && base?.type === 'raster'
      );
      if (canAttach && adjustment && base?.type === 'raster') {
        const attached = {
          id: adjustment.id,
          adjustmentKind: adjustment.adjustmentKind!,
          name: adjustment.name,
          enabled: adjustment.visible,
          revision: 0,
          adjustmentStack: adjustment.adjustmentStack
        };
        layers[layers.length - 1] = {
          ...base,
          attachedAdjustments: [...(base.attachedAdjustments ?? []), attached]
        };
        compatibility.push({
          path: `${path}[${index}]`,
          feature: 'node',
          support: 'native',
          reason: 'A simple clipped Photoshop Adjustment Layer is mapped to an ordered attached LightTable adjustment.'
        });
        return;
      }
      layers.push(...adapted);
    });
    return layers;
  }

  const layers = adaptSiblings(source.layers, 'layers');
  const activeLayerId = layers.at(-1)?.id ?? null;
  return {
    document: {
      id: `document-${crypto.randomUUID()}` as DocumentId,
      name,
      width: source.width,
      height: source.height,
      guides: [],
      resolutionPpi: source.resolutionPpi ?? 72,
      layers,
      activeLayerId,
      colorSettings: {
        mode: 'rgb',
        bitDepth: source.bitsPerChannel === 8 || source.bitsPerChannel === 16
          || source.bitsPerChannel === 32
          ? source.bitsPerChannel
          : 16,
        workingProfile: 'srgb',
        blendProfile,
        profileState: source.colorProfile.disposition === 'embedded' ? 'assigned' : 'assumed'
      },
      importProvenance: {
        decoder: 'ag-psd',
        sourceBitDepth: source.bitsPerChannel,
        sourceFormat: 'PSD',
        sourceInterpretation: source.colorMode,
        sourceProfile: source.colorProfile.disposition === 'embedded'
          ? 'embedded ICC -> sRGB'
          : 'no embedded ICC; assumed sRGB',
        sourceProfileName: source.colorProfile.name,
        normalizedColorSpace: 'linear-srgb'
      },
      photoshopImportReport: {
        warnings: [...warnings],
        compatibility: structuredClone(compatibility)
      },
      photoshopDocument: {
        engineData: source.engineData ?? null
      },
      assets: {
        patterns: source.patterns.map((pattern) => ({
          id: patternIds.get(pattern.id)!,
          name: pattern.name,
          width: pattern.width,
          height: pattern.height,
          revision: 0
        })),
        colorLookups,
        // PSD is an import format, not a second payload inside LightTable's
        // native document. Imported layers/assets become authoritative.
        preservedSources: [],
        fonts: []
      },
      revision: 0,
      createdAt: now,
      modifiedAt: now
    },
    assets,
    warnings,
    compatibility
  };
};
