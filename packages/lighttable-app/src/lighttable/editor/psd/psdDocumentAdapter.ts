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
  type DocumentAssetId,
  type DocumentId,
  type ImageDocument,
  type AdjustmentLayer,
  type LayerId,
  type LayerNode,
  type PhotoshopImportCompatibilityEntry,
  type PhotoshopImportSupport,
  type RasterLayer
} from '../document/documentTypes';
import { identityAffineMatrix } from '../rendering/renderContract';
import { importPsdLayerStyles } from './layerStylePsdAdapter';
import type { PsdDecodeSuccess, PsdLayerNodeDto } from '../../image-io/psdProtocol';
import { createDefaultAdjustments } from '../../types';
import { createAdjustmentStackFromBasicAdjustments } from '../../processing/adjustmentStack';
import type { CurvePoint } from '../../curves';

export interface PsdDocumentImport {
  document: ImageDocument;
  assets: DocumentAssetBlob[];
  warnings: string[];
  compatibility: PsdImportCompatibilityEntry[];
}

export type PsdImportSupport = PhotoshopImportSupport;
export type PsdImportCompatibilityEntry = PhotoshopImportCompatibilityEntry;

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

const rgbColor = (value: PsdColor | undefined) => {
  if (!value) return null;
  if ('r' in value && 'g' in value && 'b' in value) {
    const divisor = Math.max(value.r, value.g, value.b) > 1 ? 255 : 1;
    return {
      red: clamp(value.r / divisor, 0, 1),
      green: clamp(value.g / divisor, 0, 1),
      blue: clamp(value.b / divisor, 0, 1)
    };
  }
  if ('fr' in value && 'fg' in value && 'fb' in value) {
    return {
      red: clamp(value.fr, 0, 1),
      green: clamp(value.fg, 0, 1),
      blue: clamp(value.fb, 0, 1)
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

const importPsdAdjustment = (
  descriptor: unknown,
  warnings: string[],
  compatibility: PsdImportCompatibilityEntry[],
  path: string
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
    case 'vibrance':
      adjustments.vibrance = source.vibrance ?? 0;
      adjustments.saturation = source.saturation ?? 0;
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
        const tint = rgbColor(source.tintColor);
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
      const filterColor = rgbColor(source.color);
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
  const warnings = [...source.warnings];
  const compatibility: PsdImportCompatibilityEntry[] = [];
  const now = Date.now();
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
  const adapt = (node: PsdLayerNodeDto, path: string): LayerNode | null => {
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
      resolvePatternAsset: (patternId) => patternIds.get(patternId) ?? null
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
        mask: node.mask ? {
          id: node.mask.id,
          enabled: node.mask.enabled,
          density: node.mask.density,
          feather: node.mask.feather,
          revision: 0,
          pixelRevision: 0,
          dirtyBounds: null
        } : null,
        children: node.children
          .map((child, index) => adapt(child, `${path}.children[${index}]`))
          .filter((child): child is LayerNode => Boolean(child))
      };
    }
    if (node.kind === 'adjustment') {
      const layer: AdjustmentLayer = {
        ...common,
        type: 'adjustment',
        adjustmentStack: importPsdAdjustment(node.adjustment, warnings, compatibility, path),
        mask: node.mask ? {
          id: node.mask.id,
          enabled: node.mask.enabled,
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
    if (!node.pixels) {
      warnings.push(`${path}: ${node.kind} "${node.name}" has no raster preview and is preserved in the PSD inventory but is not rendered yet.`);
      return null;
    }
    const layer: RasterLayer = {
      ...common,
      type: 'raster',
      pixelRevision: 0,
      width: source.width,
      height: source.height,
      offsetX: 0,
      offsetY: 0,
      pixelSource: { kind: 'runtime-raster', runtimeId: node.id },
      dirtyBounds: null,
      mask: node.mask ? {
        id: node.mask.id,
        enabled: node.mask.enabled,
        density: node.mask.density,
        feather: node.mask.feather,
        revision: 0,
        pixelRevision: 0,
        dirtyBounds: null
      } : null
    };
    assets.push({ layerId: id, pixels: node.pixels, mask: node.mask?.pixels ?? null });
    if (node.kind !== 'raster') {
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

  const layers = source.layers
    .map((layer, index) => adapt(layer, `layers[${index}]`))
    .filter((layer): layer is LayerNode => Boolean(layer));
  const activeLayerId = layers.at(-1)?.id ?? null;
  return {
    document: {
      id: `document-${crypto.randomUUID()}` as DocumentId,
      name,
      width: source.width,
      height: source.height,
      layers,
      activeLayerId,
      importProvenance: {
        decoder: 'ag-psd',
        sourceBitDepth: source.bitsPerChannel,
        sourceFormat: 'PSD',
        sourceInterpretation: source.colorMode,
        sourceProfile: null,
        normalizedColorSpace: 'linear-srgb'
      },
      photoshopImportReport: {
        warnings: [...warnings],
        compatibility: structuredClone(compatibility)
      },
      assets: {
        patterns: source.patterns.map((pattern) => ({
          id: patternIds.get(pattern.id)!,
          name: pattern.name,
          width: pattern.width,
          height: pattern.height,
          revision: 0
        })),
        // PSD is an import format, not a second payload inside LightTable's
        // native document. Imported layers/assets become authoritative.
        preservedSources: []
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
