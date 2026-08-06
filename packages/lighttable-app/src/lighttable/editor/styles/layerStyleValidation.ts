import { BLEND_MODES } from '../document/blendModes';
import type {
  LayerStyleColor,
  LayerStyleContour,
  LayerStyleGradient,
  LayerStyleInstance,
  LayerStyleKind,
  LayerStylePatternReference,
  LayerStyleStack
} from './layerStyleTypes';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const normalized = (value: unknown) => finite(value) && value >= 0 && value <= 1;
const nonNegative = (value: unknown) => finite(value) && value >= 0;
const oneOf = <T extends string>(value: unknown, values: readonly T[]): value is T =>
  typeof value === 'string' && values.includes(value as T);
const blendModeIds = BLEND_MODES.map(({ id }) => id);

const isColor = (value: unknown): value is LayerStyleColor =>
  isRecord(value)
  && normalized(value.r)
  && normalized(value.g)
  && normalized(value.b)
  && normalized(value.a);

const isContour = (value: unknown): value is LayerStyleContour =>
  isRecord(value)
  && Array.isArray(value.points)
  && value.points.length >= 2
  && value.points.length <= 64
  && value.points.every((point) =>
    isRecord(point) && normalized(point.position) && normalized(point.value));

const isPattern = (value: unknown): value is LayerStylePatternReference =>
  isRecord(value)
  && typeof value.id === 'string'
  && typeof value.name === 'string'
  && (value.assetId === null || typeof value.assetId === 'string');

const isGradient = (value: unknown): value is LayerStyleGradient =>
  isRecord(value)
  && typeof value.id === 'string'
  && typeof value.name === 'string'
  && oneOf(value.type, ['solid', 'noise'])
  && normalized(value.smoothness)
  && Array.isArray(value.colorStops)
  && value.colorStops.length >= 2
  && value.colorStops.length <= 64
  && value.colorStops.every((stop) =>
    isRecord(stop)
    && typeof stop.id === 'string'
    && normalized(stop.position)
    && normalized(stop.midpoint)
    && isColor(stop.color))
  && Array.isArray(value.opacityStops)
  && value.opacityStops.length >= 2
  && value.opacityStops.length <= 64
  && value.opacityStops.every((stop) =>
    isRecord(stop)
    && typeof stop.id === 'string'
    && normalized(stop.position)
    && normalized(stop.midpoint)
    && normalized(stop.opacity))
  && normalized(value.roughness)
  && Number.isInteger(value.seed);

const commonStyle = (value: Record<string, unknown>) =>
  typeof value.id === 'string'
  && typeof value.name === 'string'
  && typeof value.enabled === 'boolean'
  && oneOf(value.blendMode, blendModeIds)
  && normalized(value.opacity);

const directional = (value: Record<string, unknown>) =>
  typeof value.useGlobalLight === 'boolean'
  && finite(value.angle)
  && nonNegative(value.distance);

const quality = (value: Record<string, unknown>) =>
  isContour(value.contour)
  && typeof value.antiAlias === 'boolean'
  && normalized(value.noise);

const isLayerStyle = (value: unknown): value is LayerStyleInstance => {
  if (!isRecord(value) || !commonStyle(value) || typeof value.kind !== 'string') return false;
  switch (value.kind as LayerStyleKind) {
    case 'drop-shadow':
      return directional(value) && quality(value) && isColor(value.color)
        && normalized(value.spread) && nonNegative(value.size)
        && typeof value.layerKnocksOut === 'boolean';
    case 'inner-shadow':
      return directional(value) && quality(value) && isColor(value.color)
        && normalized(value.choke) && nonNegative(value.size);
    case 'outer-glow':
    case 'inner-glow':
      return quality(value) && isColor(value.color)
        && (value.gradient === null || isGradient(value.gradient))
        && oneOf(value.technique, ['softer', 'precise'])
        && normalized(value.choke) && nonNegative(value.size)
        && normalized(value.range) && normalized(value.jitter)
        && (value.kind !== 'inner-glow' || oneOf(value.source, ['edge', 'center']));
    case 'bevel-emboss':
      return quality(value)
        && oneOf(value.style, ['outer-bevel', 'inner-bevel', 'emboss', 'pillow-emboss', 'stroke-emboss'])
        && oneOf(value.technique, ['smooth', 'chisel-hard', 'chisel-soft'])
        && nonNegative(value.depth) && oneOf(value.direction, ['up', 'down'])
        && nonNegative(value.size) && nonNegative(value.soften)
        && typeof value.useGlobalLight === 'boolean' && finite(value.angle)
        && finite(value.altitude) && oneOf(value.highlightMode, blendModeIds)
        && isColor(value.highlightColor) && normalized(value.highlightOpacity)
        && oneOf(value.shadowMode, blendModeIds) && isColor(value.shadowColor)
        && normalized(value.shadowOpacity) && isRecord(value.texture)
        && typeof value.texture.enabled === 'boolean'
        && (value.texture.pattern === null || isPattern(value.texture.pattern))
        && nonNegative(value.texture.scale) && finite(value.texture.depth)
        && typeof value.texture.invert === 'boolean'
        && typeof value.texture.linkWithLayer === 'boolean';
    case 'color-overlay':
      return isColor(value.color);
    case 'gradient-overlay':
      return isGradient(value.gradient)
        && typeof value.dither === 'boolean' && typeof value.reverse === 'boolean'
        && oneOf(value.style, ['linear', 'radial', 'angle', 'reflected', 'diamond'])
        && typeof value.alignWithLayer === 'boolean' && finite(value.angle)
        && nonNegative(value.scale) && finite(value.offsetX) && finite(value.offsetY)
        && oneOf(value.method, ['perceptual', 'linear', 'classic', 'smooth']);
    case 'pattern-overlay':
      return (value.pattern === null || isPattern(value.pattern))
        && finite(value.angle) && nonNegative(value.scale)
        && typeof value.linkWithLayer === 'boolean'
        && finite(value.offsetX) && finite(value.offsetY);
    case 'satin':
      return directional(value) && isColor(value.color) && nonNegative(value.size)
        && isContour(value.contour) && typeof value.antiAlias === 'boolean'
        && typeof value.invert === 'boolean';
    case 'stroke':
      if (
        !nonNegative(value.size)
        || !oneOf(value.position, ['inside', 'center', 'outside'])
        || typeof value.overprint !== 'boolean'
        || !isRecord(value.fill)
      ) return false;
      if (value.fill.type === 'color') return isColor(value.fill.color);
      if (value.fill.type === 'gradient') {
        return isGradient(value.fill.gradient)
          && typeof value.fill.dither === 'boolean'
          && typeof value.fill.reverse === 'boolean'
          && oneOf(value.fill.style, ['linear', 'radial', 'angle', 'reflected', 'diamond'])
          && typeof value.fill.alignWithLayer === 'boolean'
          && finite(value.fill.angle)
          && nonNegative(value.fill.scale)
          && finite(value.fill.offsetX)
          && finite(value.fill.offsetY)
          && oneOf(value.fill.method, ['perceptual', 'linear', 'classic', 'smooth']);
      }
      return value.fill.type === 'pattern'
        && (value.fill.pattern === null || isPattern(value.fill.pattern))
        && nonNegative(value.fill.scale) && finite(value.fill.angle);
    default:
      return false;
  }
};

export const parseLayerStyleStack = (value: unknown): LayerStyleStack => {
  if (
    !isRecord(value)
    || typeof value.enabled !== 'boolean'
    || !nonNegative(value.scale)
    || !isRecord(value.globalLight)
    || !finite(value.globalLight.angle)
    || !finite(value.globalLight.altitude)
    || !Array.isArray(value.effects)
    || value.effects.length > 64
    || !value.effects.every(isLayerStyle)
    || !Number.isInteger(value.revision)
    || Number(value.revision) < 0
  ) {
    throw new Error('The LightTable Layer Style stack is invalid.');
  }
  const ids = value.effects.map((effect) => effect.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error('The LightTable Layer Style stack contains duplicate effect ids.');
  }
  return structuredClone(value) as unknown as LayerStyleStack;
};

export const parseLayerStyleInstance = (value: unknown): LayerStyleInstance => (
  parseLayerStyleStack({ enabled: true, scale: 1, globalLight: { angle: 120, altitude: 30 },
    effects: [value], revision: 0 }).effects[0]!
);
