import type {
  BlendMode as PsdBlendMode,
  Color as PsdColor,
  EffectContour,
  EffectSolidGradient,
  LayerEffectBevel,
  LayerEffectGradientOverlay,
  LayerEffectInnerGlow,
  LayerEffectPatternOverlay,
  LayerEffectSatin,
  LayerEffectShadow,
  LayerEffectSolidFill,
  LayerEffectStroke,
  LayerEffectsInfo,
  LayerEffectsOuterGlow,
  UnitsValue
} from 'ag-psd';
import type { BlendMode } from '../document/blendModes';
import {
  createDefaultLayerStyle,
  createDefaultLayerStyleGradient,
  createDefaultLayerStyleStack,
  layerStyleColor
} from '../styles/layerStyleDefaults';
import type {
  LayerStyleColor,
  LayerStyleContour,
  LayerStyleGradient,
  LayerStyleInstance,
  LayerStylePatternReference,
  LayerStyleStack
} from '../styles/layerStyleTypes';
import type { DocumentBlendProfile } from '../document/documentTypes';
import { convertEncodedDocumentColorToSrgb } from '../color/documentColorTransform';

export type PsdStyleSupport = 'editable' | 'preserved' | 'rasterized';

export interface PsdStyleCompatibilityEntry {
  path: string;
  support: PsdStyleSupport;
  reason: string;
}

export interface PsdLayerStyleImportResult {
  stack: LayerStyleStack;
  compatibility: PsdStyleCompatibilityEntry[];
  /** Exact source descriptors retained by the PSD document adapter. */
  preservedDescriptors: unknown[];
}

export interface PsdLayerStyleAdapterOptions {
  resolvePatternAsset?: (patternId: string) => string | null;
  sourceProfile?: DocumentBlendProfile;
}

const normalizeSemanticColors = (value: unknown, sourceProfile: DocumentBlendProfile) => {
  if (sourceProfile === 'srgb' || !value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((entry) => normalizeSemanticColors(entry, sourceProfile));
    return;
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.r === 'number'
    && typeof candidate.g === 'number'
    && typeof candidate.b === 'number'
  ) {
    const converted = convertEncodedDocumentColorToSrgb({
      r: candidate.r, g: candidate.g, b: candidate.b
    }, sourceProfile);
    candidate.r = converted.r;
    candidate.g = converted.g;
    candidate.b = converted.b;
    return;
  }
  Object.values(candidate).forEach((entry) => normalizeSemanticColors(entry, sourceProfile));
};

const clamp01 = (value: number | undefined, fallback = 0) =>
  Math.min(1, Math.max(0, Number.isFinite(value) ? value! : fallback));
const normalizedPercent = (value: number | undefined, fallback = 0) =>
  clamp01(value !== undefined && value > 1 ? value / 100 : value, fallback);
const percentRatio = (value: number | undefined, fallback = 1) =>
  Number.isFinite(value) ? Math.max(0, value! > 10 ? value! / 100 : value!) : fallback;
const signedPercent = (value: number | undefined, fallback = 0) =>
  Number.isFinite(value)
    ? Math.max(-1, Math.min(1, Math.abs(value!) > 1 ? value! / 100 : value!))
    : fallback;
const pixels = (value: UnitsValue | undefined, fallback = 0) =>
  value?.units === 'Pixels' || value?.units === 'None'
    ? Math.max(0, value.value)
    : fallback;

const blendModes: Partial<Record<PsdBlendMode, BlendMode>> = {
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

const blendMode = (
  value: PsdBlendMode | string | undefined,
  fallback: BlendMode,
  path: string,
  report: PsdStyleCompatibilityEntry[]
) => {
  const mapped = value ? blendModes[value as PsdBlendMode] : fallback;
  if (!mapped && value) {
    report.push({
      path,
      support: 'rasterized',
      reason: `Blend mode "${value}" is preserved but not rendered natively.`
    });
  }
  return mapped ?? fallback;
};

const color = (
  value: PsdColor | undefined,
  fallback: LayerStyleColor,
  path: string,
  report: PsdStyleCompatibilityEntry[]
) => {
  if (!value) return fallback;
  if ('r' in value && 'g' in value && 'b' in value) {
    const divisor = Math.max(value.r, value.g, value.b) > 1 ? 255 : 1;
    return layerStyleColor(
      clamp01(value.r / divisor),
      clamp01(value.g / divisor),
      clamp01(value.b / divisor),
      'a' in value ? normalizedPercent(value.a, 1) : 1
    );
  }
  if ('fr' in value && 'fg' in value && 'fb' in value) {
    return layerStyleColor(clamp01(value.fr), clamp01(value.fg), clamp01(value.fb));
  }
  report.push({
    path,
    support: 'rasterized',
    reason: 'Non-RGB Photoshop effect colors require color-managed conversion.'
  });
  return fallback;
};

const contour = (value: EffectContour | undefined): LayerStyleContour =>
  value?.curve?.length
    ? {
        points: value.curve.map(({ x, y }) => ({
          position: clamp01(x > 1 ? x / 255 : x),
          value: clamp01(y > 1 ? y / 255 : y)
        }))
      }
    : { points: [{ position: 0, value: 0 }, { position: 1, value: 1 }] };

const pattern = (
  value: { id: string; name: string } | undefined,
  options: PsdLayerStyleAdapterOptions
): LayerStylePatternReference | null => value ? {
  id: value.id,
  name: value.name,
  assetId: options.resolvePatternAsset?.(value.id) ?? null
} : null;

const solidGradient = (
  value: EffectSolidGradient,
  report: PsdStyleCompatibilityEntry[],
  path: string
): LayerStyleGradient => {
  const gradient = createDefaultLayerStyleGradient();
  gradient.name = value.name;
  gradient.smoothness = normalizedPercent(value.smoothness, 1);
  gradient.colorStops = value.colorStops.map((stop, index) => ({
    id: `psd-color-${index}`,
    position: clamp01(stop.location > 1 ? stop.location / 4096 : stop.location),
    midpoint: normalizedPercent(stop.midpoint, 0.5),
    color: color(stop.color, layerStyleColor(0, 0, 0), `${path}.colorStops[${index}]`, report)
  }));
  gradient.opacityStops = value.opacityStops.map((stop, index) => ({
    id: `psd-opacity-${index}`,
    position: clamp01(stop.location > 1 ? stop.location / 4096 : stop.location),
    midpoint: normalizedPercent(stop.midpoint, 0.5),
    opacity: normalizedPercent(stop.opacity, 1)
  }));
  return gradient;
};

const common = (
  effect: { enabled?: boolean; opacity?: number; blendMode?: PsdBlendMode | string },
  target: LayerStyleInstance,
  path: string,
  report: PsdStyleCompatibilityEntry[]
) => {
  target.enabled = effect.enabled ?? true;
  target.opacity = normalizedPercent(effect.opacity, target.opacity);
  target.blendMode = blendMode(effect.blendMode, target.blendMode, `${path}.blendMode`, report);
  return target;
};

const shadow = (
  value: LayerEffectShadow,
  kind: 'drop-shadow' | 'inner-shadow',
  path: string,
  report: PsdStyleCompatibilityEntry[]
) => {
  const effect = common(value, createDefaultLayerStyle(kind), path, report);
  if (effect.kind !== kind) throw new Error('Layer Style shadow adapter mismatch.');
  effect.size = pixels(value.size, effect.size);
  effect.angle = value.angle ?? effect.angle;
  effect.distance = pixels(value.distance, effect.distance);
  effect.color = color(value.color, effect.color, `${path}.color`, report);
  effect.useGlobalLight = value.useGlobalLight ?? effect.useGlobalLight;
  effect.antiAlias = value.antialiased ?? effect.antiAlias;
  effect.contour = contour(value.contour);
  if (kind === 'drop-shadow' && effect.kind === 'drop-shadow') {
    effect.spread = value.choke ? normalizedPercent(value.choke.value) : effect.spread;
    effect.layerKnocksOut = value.layerConceals ?? effect.layerKnocksOut;
  } else if (effect.kind === 'inner-shadow') {
    effect.choke = value.choke ? normalizedPercent(value.choke.value) : effect.choke;
  }
  return effect;
};

const glow = (
  value: LayerEffectsOuterGlow | LayerEffectInnerGlow,
  kind: 'outer-glow' | 'inner-glow',
  path: string,
  report: PsdStyleCompatibilityEntry[]
) => {
  const effect = common(value, createDefaultLayerStyle(kind), path, report);
  if (effect.kind !== kind) throw new Error('Layer Style glow adapter mismatch.');
  effect.size = pixels(value.size, effect.size);
  effect.color = color(value.color, effect.color, `${path}.color`, report);
  effect.antiAlias = value.antialiased ?? effect.antiAlias;
  effect.noise = normalizedPercent(value.noise, effect.noise);
  effect.range = normalizedPercent(value.range, effect.range);
  effect.choke = value.choke ? normalizedPercent(value.choke.value) : effect.choke;
  effect.jitter = normalizedPercent(value.jitter, effect.jitter);
  effect.contour = contour(value.contour);
  if (effect.kind === 'inner-glow') {
    effect.source = value.source === 'center' ? 'center' : 'edge';
    effect.technique = 'technique' in value && value.technique === 'precise'
      ? 'precise'
      : 'softer';
  }
  return effect;
};

const solidFill = (
  value: LayerEffectSolidFill,
  path: string,
  report: PsdStyleCompatibilityEntry[]
) => {
  const effect = common(value, createDefaultLayerStyle('color-overlay'), path, report);
  if (effect.kind !== 'color-overlay') throw new Error('Color Overlay adapter mismatch.');
  effect.color = color(value.color, effect.color, `${path}.color`, report);
  return effect;
};

const satin = (
  value: LayerEffectSatin,
  path: string,
  report: PsdStyleCompatibilityEntry[]
) => {
  const effect = common(value, createDefaultLayerStyle('satin'), path, report);
  if (effect.kind !== 'satin') throw new Error('Satin adapter mismatch.');
  effect.size = pixels(value.size, effect.size);
  effect.distance = pixels(value.distance, effect.distance);
  effect.angle = value.angle ?? effect.angle;
  effect.color = color(value.color, effect.color, `${path}.color`, report);
  effect.antiAlias = value.antialiased ?? effect.antiAlias;
  effect.invert = value.invert ?? effect.invert;
  effect.contour = contour(value.contour);
  return effect;
};

const bevel = (
  value: LayerEffectBevel,
  path: string,
  report: PsdStyleCompatibilityEntry[]
) => {
  const effect = common(value, createDefaultLayerStyle('bevel-emboss'), path, report);
  if (effect.kind !== 'bevel-emboss') throw new Error('Bevel adapter mismatch.');
  effect.size = pixels(value.size, effect.size);
  effect.soften = pixels(value.soften, effect.soften);
  effect.angle = value.angle ?? effect.angle;
  effect.altitude = value.altitude ?? effect.altitude;
  effect.depth = percentRatio(value.strength, effect.depth);
  effect.useGlobalLight = value.useGlobalLight ?? effect.useGlobalLight;
  effect.highlightMode = blendMode(
    value.highlightBlendMode,
    effect.highlightMode,
    `${path}.highlightBlendMode`,
    report
  );
  effect.shadowMode = blendMode(
    value.shadowBlendMode,
    effect.shadowMode,
    `${path}.shadowBlendMode`,
    report
  );
  effect.highlightColor = color(
    value.highlightColor,
    effect.highlightColor,
    `${path}.highlightColor`,
    report
  );
  effect.shadowColor = color(
    value.shadowColor,
    effect.shadowColor,
    `${path}.shadowColor`,
    report
  );
  effect.highlightOpacity = normalizedPercent(value.highlightOpacity, effect.highlightOpacity);
  effect.shadowOpacity = normalizedPercent(value.shadowOpacity, effect.shadowOpacity);
  effect.style = value.style === 'outer bevel' ? 'outer-bevel'
    : value.style === 'inner bevel' ? 'inner-bevel'
      : value.style === 'pillow emboss' ? 'pillow-emboss'
        : value.style === 'stroke emboss' ? 'stroke-emboss'
          : value.style === 'emboss' ? 'emboss' : effect.style;
  effect.technique = value.technique === 'chisel hard' ? 'chisel-hard'
    : value.technique === 'chisel soft' ? 'chisel-soft'
      : value.technique === 'smooth' ? 'smooth' : effect.technique;
  effect.direction = value.direction ?? effect.direction;
  effect.antiAlias = value.antialiasGloss ?? effect.antiAlias;
  effect.contour = contour(value.contour);
  if (value.useTexture) {
    report.push({
      path: `${path}.texture`,
      support: 'preserved',
      reason: 'ag-psd does not expose enough Bevel Texture metadata for exact editable rendering.'
    });
  }
  return effect;
};

const gradientOverlay = (
  value: LayerEffectGradientOverlay,
  path: string,
  report: PsdStyleCompatibilityEntry[],
  preserved: unknown[]
) => {
  const effect = common(value, createDefaultLayerStyle('gradient-overlay'), path, report);
  if (effect.kind !== 'gradient-overlay') throw new Error('Gradient Overlay adapter mismatch.');
  effect.dither = value.dither ?? effect.dither;
  effect.reverse = value.reverse ?? effect.reverse;
  effect.alignWithLayer = value.align ?? effect.alignWithLayer;
  effect.angle = value.angle ?? effect.angle;
  effect.scale = percentRatio(value.scale, effect.scale);
  effect.offsetX = signedPercent(value.offset?.x, 0);
  effect.offsetY = signedPercent(value.offset?.y, 0);
  effect.style = value.type ?? effect.style;
  effect.method = value.interpolationMethod ?? effect.method;
  if (value.gradient?.type === 'solid') {
    effect.gradient = solidGradient(value.gradient, report, `${path}.gradient`);
  } else if (value.gradient?.type === 'noise') {
    effect.enabled = false;
    preserved.push(value);
    report.push({
      path: `${path}.gradient`,
      support: 'rasterized',
      reason: 'Noise-gradient semantics are preserved but not rendered by the current style shader.'
    });
  }
  return effect;
};

const stroke = (
  value: LayerEffectStroke,
  path: string,
  report: PsdStyleCompatibilityEntry[],
  preserved: unknown[],
  options: PsdLayerStyleAdapterOptions
) => {
  const effect = common(value, createDefaultLayerStyle('stroke'), path, report);
  if (effect.kind !== 'stroke') throw new Error('Stroke adapter mismatch.');
  effect.size = pixels(value.size, effect.size);
  effect.position = value.position ?? effect.position;
  effect.overprint = value.overprint ?? effect.overprint;
  if (value.fillType === 'gradient' && value.gradient?.type === 'solid') {
    effect.fill = {
      type: 'gradient',
      gradient: solidGradient(value.gradient, report, `${path}.gradient`),
      dither: value.gradient.dither ?? false,
      reverse: value.gradient.reverse ?? false,
      style: value.gradient.style ?? 'linear',
      alignWithLayer: value.gradient.align ?? true,
      angle: value.gradient.angle ?? 0,
      scale: percentRatio(value.gradient.scale, 1),
      offsetX: signedPercent(value.gradient.offset?.x, 0),
      offsetY: signedPercent(value.gradient.offset?.y, 0),
      method: value.gradient.interpolationMethod ?? 'perceptual'
    };
  } else if (value.fillType === 'pattern') {
    effect.fill = {
      type: 'pattern',
      pattern: pattern(value.pattern, options),
      scale: 1,
      angle: 0
    };
    if (!effect.fill.pattern?.assetId) {
      preserved.push(value);
      report.push({
        path: `${path}.pattern`,
        support: 'preserved',
        reason: 'Pattern descriptor is retained; pixels are unresolved and render as a no-op.'
      });
    }
  } else if (value.fillType === 'gradient') {
    effect.enabled = false;
    preserved.push(value);
    report.push({
      path: `${path}.gradient`,
      support: 'rasterized',
      reason: 'Noise-gradient Stroke is preserved and uses the Photoshop layer preview.'
    });
  } else {
    effect.fill = {
      type: 'color',
      color: color(value.color, layerStyleColor(1, 1, 1), `${path}.color`, report)
    };
  }
  return effect;
};

const patternOverlay = (
  value: LayerEffectPatternOverlay,
  path: string,
  report: PsdStyleCompatibilityEntry[],
  preserved: unknown[],
  options: PsdLayerStyleAdapterOptions
) => {
  const effect = common(value, createDefaultLayerStyle('pattern-overlay'), path, report);
  if (effect.kind !== 'pattern-overlay') throw new Error('Pattern Overlay adapter mismatch.');
  effect.scale = percentRatio(value.scale, effect.scale);
  effect.linkWithLayer = value.align ?? effect.linkWithLayer;
  effect.offsetX = value.phase?.x ?? 0;
  effect.offsetY = value.phase?.y ?? 0;
  effect.pattern = pattern(value.pattern, options);
  if (!effect.pattern?.assetId) {
    preserved.push(value);
    report.push({
      path: `${path}.pattern`,
      support: 'preserved',
      reason: 'Pattern descriptor is retained; pixels are unresolved and render as a no-op.'
    });
  }
  return effect;
};

export const importPsdLayerStyles = (
  source: LayerEffectsInfo | undefined,
  options: PsdLayerStyleAdapterOptions = {}
): PsdLayerStyleImportResult => {
  const stack = createDefaultLayerStyleStack();
  const compatibility: PsdStyleCompatibilityEntry[] = [];
  const preservedDescriptors: unknown[] = [];
  if (!source) return { stack, compatibility, preservedDescriptors };
  stack.enabled = !(source.disabled ?? false);
  stack.scale = percentRatio(source.scale, 1);
  source.dropShadow?.forEach((value, index) =>
    stack.effects.push(shadow(value, 'drop-shadow', `dropShadow[${index}]`, compatibility)));
  source.innerShadow?.forEach((value, index) =>
    stack.effects.push(shadow(value, 'inner-shadow', `innerShadow[${index}]`, compatibility)));
  if (source.outerGlow) {
    stack.effects.push(glow(source.outerGlow, 'outer-glow', 'outerGlow', compatibility));
  }
  if (source.innerGlow) {
    stack.effects.push(glow(source.innerGlow, 'inner-glow', 'innerGlow', compatibility));
  }
  if (source.bevel) stack.effects.push(bevel(source.bevel, 'bevel', compatibility));
  source.solidFill?.forEach((value, index) =>
    stack.effects.push(solidFill(value, `solidFill[${index}]`, compatibility)));
  if (source.satin) stack.effects.push(satin(source.satin, 'satin', compatibility));
  source.stroke?.forEach((value, index) =>
    stack.effects.push(stroke(
      value,
      `stroke[${index}]`,
      compatibility,
      preservedDescriptors,
      options
    )));
  source.gradientOverlay?.forEach((value, index) =>
    stack.effects.push(gradientOverlay(
      value,
      `gradientOverlay[${index}]`,
      compatibility,
      preservedDescriptors
    )));
  if (source.patternOverlay) {
    stack.effects.push(patternOverlay(
      source.patternOverlay,
      'patternOverlay',
      compatibility,
      preservedDescriptors,
      options
    ));
  }
  if (stack.effects.length) {
    compatibility.unshift({
      path: 'effects',
      support: 'editable',
      reason: `${stack.effects.length} Photoshop Layer Style effect(s) mapped to the canonical stack.`
    });
  }
  normalizeSemanticColors(stack, options.sourceProfile ?? 'srgb');
  return { stack, compatibility, preservedDescriptors };
};
