import type {
  AdjustmentLayer as PsdAdjustment,
  ChannelMixerChannel,
  Color,
  CurvesAdjustmentChannel,
  LevelsAdjustmentChannel
} from 'ag-psd';
import type { AdjustmentLayerKind } from '../../processing/adjustmentLayerCatalog';
import { materializeBasicAdjustments, type AdjustmentStack } from '../../processing/adjustmentStack';
import {
  isPhotoshopAdjustmentKind,
  type PhotoshopAdjustmentSettings
} from '../../photoshopAdjustments';

const byte = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 255);
const color = (value: { readonly r: number; readonly g: number; readonly b: number }): Color => ({
  r: byte(value.r), g: byte(value.g), b: byte(value.b)
});
const curve = (points: readonly { x: number; y: number }[]): CurvesAdjustmentChannel =>
  points.map(({ x, y }) => ({ input: byte(x), output: byte(y) }));
const mixer = (values: readonly number[]): ChannelMixerChannel => ({
  red: values[0] ?? 0,
  green: values[1] ?? 0,
  blue: values[2] ?? 0,
  constant: values[3] ?? 0
});
const levels = (
  settings: PhotoshopAdjustmentSettings,
  channel: PhotoshopAdjustmentSettings['levelsChannel']
): LevelsAdjustmentChannel => ({
  shadowInput: Math.round(settings.levels[channel].input[0]),
  midtoneInput: settings.levels[channel].input[1],
  highlightInput: Math.round(settings.levels[channel].input[2]),
  shadowOutput: Math.round(settings.levels[channel].output[0]),
  highlightOutput: Math.round(settings.levels[channel].output[1])
});

const lookupTransform = (
  preset: PhotoshopAdjustmentSettings['colorLookupPreset'],
  rgb: readonly [number, number, number]
): readonly [number, number, number] => {
  const [r, g, b] = rgb;
  if (preset === 'film-stock') {
    return [
      Math.max(0, r * 1.08 - g * 0.03 - b * 0.01) ** 0.94,
      Math.max(0, -r * 0.02 + g * 1.03 + b * 0.01) ** 0.94,
      Math.max(0, r * 0.01 - g * 0.04 + b * 0.94) ** 0.94
    ];
  }
  const luminance = r * 0.2126 + g * 0.7152 + b * 0.0722;
  if (preset === 'moonlight') {
    return [
      r * 0.45 + luminance * 0.62 * 0.55,
      g * 0.45 + luminance * 0.76 * 0.55,
      b * 0.45 + luminance * 1.08 * 0.55
    ];
  }
  if (preset === 'teal-orange') {
    return [
      r + 0.02 * (1 - luminance) + 0.18 * luminance,
      g + 0.14 * (1 - luminance) + 0.07 * luminance,
      b + 0.16 * (1 - luminance) - 0.03 * luminance
    ];
  }
  return rgb;
};

const lookupCube = (preset: PhotoshopAdjustmentSettings['colorLookupPreset']) => {
  const size = 17;
  const lines = [
    `TITLE "LightTable ${preset}"`,
    `LUT_3D_SIZE ${size}`,
    'DOMAIN_MIN 0 0 0',
    'DOMAIN_MAX 1 1 1'
  ];
  for (let blue = 0; blue < size; blue += 1) {
    for (let green = 0; green < size; green += 1) {
      for (let red = 0; red < size; red += 1) {
        const mapped = lookupTransform(preset, [
          red / (size - 1), green / (size - 1), blue / (size - 1)
        ]);
        lines.push(mapped.map((value) => value.toFixed(7)).join(' '));
      }
    }
  }
  return new TextEncoder().encode(`${lines.join('\n')}\n`);
};

const photoshopAdjustment = (
  settings: PhotoshopAdjustmentSettings,
  resolveColorLookup: ColorLookupPsdResolver
): PsdAdjustment | null => {
  switch (settings.kind) {
    case 'brightness-contrast': return {
      type: 'brightness/contrast', brightness: settings.brightness,
      contrast: settings.contrast, useLegacy: settings.useLegacyBrightnessContrast
    };
    case 'levels': {
      return {
        type: 'levels',
        rgb: levels(settings, 'rgb'),
        red: levels(settings, 'red'),
        green: levels(settings, 'green'),
        blue: levels(settings, 'blue')
      };
    }
    case 'exposure': return {
      type: 'exposure', exposure: settings.exposure,
      offset: settings.exposureOffset, gamma: settings.exposureGamma
    };
    case 'hue-saturation': return {
      type: 'hue/saturation',
      master: settings.colorize ? {
        a: 256,
        b: settings.hue > 180 ? settings.hue - 360 : settings.hue,
        c: settings.hueSaturation,
        d: settings.hueLightness,
        hue: 0, saturation: 0, lightness: 0
      } : {
        a: 0, b: -144, c: 25, d: 0,
        hue: settings.hue,
        saturation: settings.hueSaturation,
        lightness: settings.hueLightness
      },
      ...Object.fromEntries((['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas'] as const).map((channel) => {
        const range = settings.hueSaturationRanges[channel];
        return [channel, {
          a: range.boundaries[0], b: range.boundaries[1],
          c: range.boundaries[2], d: range.boundaries[3],
          hue: range.hue, saturation: range.saturation, lightness: range.lightness
        }];
      }))
    };
    case 'color-balance': return {
      type: 'color balance',
      shadows: {
        cyanRed: settings.colorBalanceShadows[0],
        magentaGreen: settings.colorBalanceShadows[1],
        yellowBlue: settings.colorBalanceShadows[2]
      },
      midtones: {
        cyanRed: settings.colorBalanceMidtones[0],
        magentaGreen: settings.colorBalanceMidtones[1],
        yellowBlue: settings.colorBalanceMidtones[2]
      },
      highlights: {
        cyanRed: settings.colorBalanceHighlights[0],
        magentaGreen: settings.colorBalanceHighlights[1],
        yellowBlue: settings.colorBalanceHighlights[2]
      },
      preserveLuminosity: settings.preserveLuminosity
    };
    case 'black-white': return {
      type: 'black & white',
      reds: settings.blackWhiteMix[0], yellows: settings.blackWhiteMix[1],
      greens: settings.blackWhiteMix[2], cyans: settings.blackWhiteMix[3],
      blues: settings.blackWhiteMix[4], magentas: settings.blackWhiteMix[5],
      useTint: settings.blackWhiteTint,
      tintColor: color(settings.blackWhiteTintColor)
    };
    case 'photo-filter': return {
      type: 'photo filter', color: color(settings.photoFilterColor),
      density: settings.photoFilterDensity,
      preserveLuminosity: settings.preserveLuminosity
    };
    case 'channel-mixer': return {
      type: 'channel mixer', monochrome: settings.channelMixerMonochrome,
      red: mixer(settings.channelMixerRed), green: mixer(settings.channelMixerGreen),
      blue: mixer(settings.channelMixerBlue), gray: mixer(settings.channelMixerRed)
    };
    case 'color-lookup': {
      if (settings.colorLookupAssetId) {
        const asset = resolveColorLookup(settings.colorLookupAssetId);
        if (!asset) return null;
        return {
          type: 'color lookup', lookupType: '3dlut', dither: true,
          lutFormat: 'cube', dataOrder: 'rgb', tableOrder: 'rgb',
          lut3DFileName: asset.name,
          lut3DFileData: asset.data
        };
      }
      return settings.colorLookupPreset === 'none'
      ? { type: 'color lookup', lookupType: '3dlut', name: 'LightTable Identity' }
      : {
          type: 'color lookup', lookupType: '3dlut', dither: true,
          lutFormat: 'cube', dataOrder: 'rgb', tableOrder: 'rgb',
          lut3DFileName: `LightTable-${settings.colorLookupPreset}.cube`,
          lut3DFileData: lookupCube(settings.colorLookupPreset)
        };
    }
    case 'selective-color': {
      const ranges = Array.from({ length: 9 }, (_, index) => ({
        c: settings.selectiveColorValues[index * 4] ?? 0,
        m: settings.selectiveColorValues[index * 4 + 1] ?? 0,
        y: settings.selectiveColorValues[index * 4 + 2] ?? 0,
        k: settings.selectiveColorValues[index * 4 + 3] ?? 0
      }));
      return {
        type: 'selective color', mode: settings.selectiveColorMethod,
        reds: ranges[0], yellows: ranges[1], greens: ranges[2], cyans: ranges[3],
        blues: ranges[4], magentas: ranges[5], whites: ranges[6],
        neutrals: ranges[7], blacks: ranges[8]
      };
    }
    case 'invert': return { type: 'invert' };
    case 'posterize': return { type: 'posterize', levels: settings.posterizeLevels };
    case 'threshold': return { type: 'threshold', level: settings.thresholdLevel };
  }
};

export type ColorLookupPsdResolver = (
  assetId: string
) => { readonly name: string; readonly data: Uint8Array } | null;

const noColorLookupAsset: ColorLookupPsdResolver = () => null;

/** Projects every currently-authored Photoshop-family node to a native PSD descriptor. */
export const exportAdjustmentStackToPsd = (
  kind: AdjustmentLayerKind | null,
  stack: AdjustmentStack,
  resolveColorLookup: ColorLookupPsdResolver = noColorLookupAsset
): PsdAdjustment | null => {
  const adjustments = materializeBasicAdjustments(stack);
  const moduleTypes = new Set(stack.modules.map((module) => module.type));
  const effectiveKind = kind
    ?? (moduleTypes.size === 1 && moduleTypes.has('lt.curves') ? 'curves' : null)
    ?? (moduleTypes.size === 1 && moduleTypes.has('lt.gradient-map') ? 'gradient-map' : null)
    ?? (adjustments.gradientMap?.enabled ? 'gradient-map' : null)
    ?? (moduleTypes.size === 1 && moduleTypes.has('lt.photoshop-adjustment')
      ? adjustments.photoshopAdjustment.kind
      : null);
  if (effectiveKind === 'curves') return {
    type: 'curves', rgb: curve(adjustments.curves.master),
    red: curve(adjustments.curves.red), green: curve(adjustments.curves.green),
    blue: curve(adjustments.curves.blue)
  };
  if (effectiveKind === 'gradient-map' && adjustments.gradientMap?.enabled) {
    const gradient = adjustments.gradientMap;
    return {
      type: 'gradient map', gradientType: 'solid', reverse: gradient.reverse,
      dither: gradient.dither,
      colorStops: gradient.colorStops.map((stop) => ({
        location: Math.round(stop.position * 4096), midpoint: Math.round(stop.midpoint * 100),
        color: color(stop.color)
      })),
      opacityStops: gradient.opacityStops.map((stop) => ({
        location: Math.round(stop.position * 4096), midpoint: Math.round(stop.midpoint * 100),
        opacity: Math.round(stop.opacity * 100)
      }))
    };
  }
  if (effectiveKind === 'color-vibrance' || effectiveKind === 'vibrance') return {
    type: 'vibrance', vibrance: adjustments.vibrance, saturation: adjustments.saturation
  };
  if (!effectiveKind || !isPhotoshopAdjustmentKind(effectiveKind)) return null;
  return photoshopAdjustment(
    { ...adjustments.photoshopAdjustment, kind: effectiveKind },
    resolveColorLookup
  );
};

export const adjustmentStackHasEditablePsdDescriptor = (
  kind: AdjustmentLayerKind,
  stack: AdjustmentStack
) => {
  const settings = materializeBasicAdjustments(stack).photoshopAdjustment;
  return kind === 'color-lookup' && Boolean(settings.colorLookupAssetId)
    ? true
    : exportAdjustmentStackToPsd(kind, stack) !== null;
};
