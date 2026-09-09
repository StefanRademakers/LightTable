import { BLEND_MODES } from '../../editor/document/blendModes';
import { createDefaultLayerStyle } from '../../editor/styles/layerStyleDefaults';
import { parseLayerStyleStack } from '../../editor/styles/layerStyleValidation';
import {
  MAX_LAYER_STYLE_MAGNITUDE,
  MAX_LAYER_STYLE_SCALE
} from '../../editor/styles/layerStyleValidation';
import type {
  LayerStyleInstance,
  LayerStyleKind,
  LayerStyleStack
} from '../../editor/styles/layerStyleTypes';

export type LayerStyleSnapshot = Omit<LayerStyleStack, 'revision'>;

export const layerStyleSnapshotsEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((value, index) => layerStyleSnapshotsEqual(value, right[index]));
  }
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = Object.keys(leftRecord);
  return keys.length === Object.keys(rightRecord).length
    && keys.every((key) => Object.hasOwn(rightRecord, key)
      && layerStyleSnapshotsEqual(leftRecord[key], rightRecord[key]));
};

const KINDS: readonly LayerStyleKind[] = [
  'drop-shadow', 'inner-shadow', 'outer-glow', 'inner-glow', 'bevel-emboss',
  'color-overlay', 'gradient-overlay', 'pattern-overlay', 'satin', 'stroke'
];
const BLEND_MODE_IDS = BLEND_MODES.map(({ id }) => id);
const record = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
};
const finite = (value: unknown, minimum: number, maximum: number) => (
  typeof value === 'number' && Number.isFinite(value)
  && value >= minimum && value <= maximum
);
const finiteValue = (value: unknown): value is number => (
  typeof value === 'number' && Number.isFinite(value)
);
const bounded = (value: unknown, maximum = MAX_LAYER_STYLE_MAGNITUDE): value is number => (
  finiteValue(value) && Math.abs(value) <= maximum
);
const nonNegative = (value: unknown, maximum = MAX_LAYER_STYLE_MAGNITUDE): value is number => (
  bounded(value, maximum) && value >= 0
);
const id = (value: unknown) => typeof value === 'string';
const name = (value: unknown) => typeof value === 'string';
const oneOf = (value: unknown, values: readonly string[]) => (
  typeof value === 'string' && values.includes(value)
);
const color = (value: unknown) => record(value)
  && exactKeys(value, ['r', 'g', 'b', 'a'])
  && ['r', 'g', 'b', 'a'].every((key) => finite(value[key], 0, 1));
const contour = (value: unknown) => record(value)
  && exactKeys(value, ['points'])
  && Array.isArray(value.points) && value.points.length >= 2 && value.points.length <= 64
  && value.points.every((point) => record(point)
    && exactKeys(point, ['position', 'value'])
    && finite(point.position, 0, 1) && finite(point.value, 0, 1));
const pattern = (value: unknown) => record(value)
  && exactKeys(value, ['id', 'name', 'assetId'])
  && id(value.id) && name(value.name) && (value.assetId === null || id(value.assetId));
const gradient = (value: unknown) => record(value)
  && exactKeys(value, [
    'id', 'name', 'type', 'smoothness', 'colorStops', 'opacityStops', 'roughness', 'seed'
  ])
  && id(value.id) && name(value.name) && oneOf(value.type, ['solid', 'noise'])
  && finite(value.smoothness, 0, 1) && finite(value.roughness, 0, 1)
  && Number.isInteger(value.seed)
  && Array.isArray(value.colorStops) && value.colorStops.length >= 2
  && value.colorStops.length <= 64 && value.colorStops.every((stop) => record(stop)
    && exactKeys(stop, ['id', 'position', 'midpoint', 'color'])
    && id(stop.id) && finite(stop.position, 0, 1) && finite(stop.midpoint, 0, 1)
    && color(stop.color))
  && Array.isArray(value.opacityStops) && value.opacityStops.length >= 2
  && value.opacityStops.length <= 64 && value.opacityStops.every((stop) => record(stop)
    && exactKeys(stop, ['id', 'position', 'midpoint', 'opacity'])
    && id(stop.id) && finite(stop.position, 0, 1) && finite(stop.midpoint, 0, 1)
    && finite(stop.opacity, 0, 1));
const nullablePattern = (value: unknown) => value === null || pattern(value);
const gradientFill = (value: Record<string, unknown>) => (
  exactKeys(value, [
    'type', 'gradient', 'dither', 'reverse', 'style', 'alignWithLayer',
    'angle', 'scale', 'offsetX', 'offsetY', 'method'
  ])
  && value.type === 'gradient' && gradient(value.gradient)
  && typeof value.dither === 'boolean' && typeof value.reverse === 'boolean'
  && oneOf(value.style, ['linear', 'radial', 'angle', 'reflected', 'diamond'])
  && typeof value.alignWithLayer === 'boolean' && bounded(value.angle)
  && nonNegative(value.scale, MAX_LAYER_STYLE_SCALE) && bounded(value.offsetX)
  && bounded(value.offsetY)
  && oneOf(value.method, ['perceptual', 'linear', 'classic', 'smooth'])
);
const fill = (value: unknown) => {
  if (!record(value) || typeof value.type !== 'string') return false;
  if (value.type === 'color') return exactKeys(value, ['type', 'color']) && color(value.color);
  if (value.type === 'gradient') return gradientFill(value);
  return value.type === 'pattern'
    && exactKeys(value, ['type', 'pattern', 'scale', 'angle'])
    && nullablePattern(value.pattern) && nonNegative(value.scale, MAX_LAYER_STYLE_SCALE)
    && bounded(value.angle);
};

const common = (effect: Record<string, unknown>, kind: LayerStyleKind) => (
  effect.kind === kind && id(effect.id) && name(effect.name)
  && typeof effect.enabled === 'boolean' && oneOf(effect.blendMode, BLEND_MODE_IDS)
  && finite(effect.opacity, 0, 1)
);
const directional = (effect: Record<string, unknown>) => (
  typeof effect.useGlobalLight === 'boolean' && bounded(effect.angle)
  && nonNegative(effect.distance)
);
const quality = (effect: Record<string, unknown>) => contour(effect.contour)
  && typeof effect.antiAlias === 'boolean' && finite(effect.noise, 0, 1);
const exactEffectKeys = (effect: Record<string, unknown>, kind: LayerStyleKind) => (
  exactKeys(effect, Object.keys(createDefaultLayerStyle(kind)))
);

const completeEffect = (value: unknown): value is LayerStyleInstance => {
  if (!record(value) || !oneOf(value.kind, KINDS)) return false;
  const kind = value.kind as LayerStyleKind;
  if (!exactEffectKeys(value, kind) || !common(value, kind)) return false;
  switch (kind) {
    case 'drop-shadow':
      return directional(value) && quality(value) && color(value.color)
        && finite(value.spread, 0, 1) && nonNegative(value.size)
        && typeof value.layerKnocksOut === 'boolean';
    case 'inner-shadow':
      return directional(value) && quality(value) && color(value.color)
        && finite(value.choke, 0, 1) && nonNegative(value.size);
    case 'outer-glow':
    case 'inner-glow':
      return quality(value) && color(value.color)
        && (value.gradient === null || gradient(value.gradient))
        && oneOf(value.technique, ['softer', 'precise'])
        && finite(value.choke, 0, 1) && nonNegative(value.size)
        && finite(value.range, 0, 1) && finite(value.jitter, 0, 1)
        && (kind !== 'inner-glow' || oneOf(value.source, ['edge', 'center']));
    case 'bevel-emboss': {
      const texture = value.texture;
      return quality(value)
        && oneOf(value.style, [
          'outer-bevel', 'inner-bevel', 'emboss', 'pillow-emboss', 'stroke-emboss'
        ])
        && oneOf(value.technique, ['smooth', 'chisel-hard', 'chisel-soft'])
        && nonNegative(value.depth) && oneOf(value.direction, ['up', 'down'])
        && nonNegative(value.size) && nonNegative(value.soften)
        && typeof value.useGlobalLight === 'boolean' && bounded(value.angle)
        && bounded(value.altitude) && oneOf(value.highlightMode, BLEND_MODE_IDS)
        && color(value.highlightColor) && finite(value.highlightOpacity, 0, 1)
        && oneOf(value.shadowMode, BLEND_MODE_IDS) && color(value.shadowColor)
        && finite(value.shadowOpacity, 0, 1) && record(texture)
        && exactKeys(texture, ['enabled', 'pattern', 'scale', 'depth', 'invert', 'linkWithLayer'])
        && typeof texture.enabled === 'boolean' && nullablePattern(texture.pattern)
        && nonNegative(texture.scale, MAX_LAYER_STYLE_SCALE) && bounded(texture.depth)
        && typeof texture.invert === 'boolean' && typeof texture.linkWithLayer === 'boolean';
    }
    case 'color-overlay': return color(value.color);
    case 'gradient-overlay':
      return gradient(value.gradient) && typeof value.dither === 'boolean'
        && typeof value.reverse === 'boolean'
        && oneOf(value.style, ['linear', 'radial', 'angle', 'reflected', 'diamond'])
        && typeof value.alignWithLayer === 'boolean' && bounded(value.angle)
        && nonNegative(value.scale, MAX_LAYER_STYLE_SCALE) && bounded(value.offsetX)
        && bounded(value.offsetY)
        && oneOf(value.method, ['perceptual', 'linear', 'classic', 'smooth']);
    case 'pattern-overlay':
      return nullablePattern(value.pattern) && bounded(value.angle)
        && nonNegative(value.scale, MAX_LAYER_STYLE_SCALE)
        && typeof value.linkWithLayer === 'boolean'
        && bounded(value.offsetX) && bounded(value.offsetY);
    case 'satin':
      return directional(value) && color(value.color) && nonNegative(value.size)
        && contour(value.contour) && typeof value.antiAlias === 'boolean'
        && typeof value.invert === 'boolean';
    case 'stroke':
      return nonNegative(value.size)
        && oneOf(value.position, ['inside', 'center', 'outside'])
        && typeof value.overprint === 'boolean' && fill(value.fill);
  }
};

export const layerStyleSnapshot = (stack: LayerStyleStack): LayerStyleSnapshot => {
  const { revision: _revision, ...snapshot } = structuredClone(stack);
  return snapshot;
};

/** Strict, bounded codec for one externally replayable complete style stack. */
export const parseCompleteLayerStyleSnapshot = (value: unknown): LayerStyleSnapshot | null => {
  if (!record(value) || !exactKeys(value, ['enabled', 'scale', 'globalLight', 'effects'])
    || typeof value.enabled !== 'boolean'
    || !nonNegative(value.scale, MAX_LAYER_STYLE_SCALE)
    || !record(value.globalLight) || !exactKeys(value.globalLight, ['angle', 'altitude'])
    || !bounded(value.globalLight.angle) || !bounded(value.globalLight.altitude)
    || !Array.isArray(value.effects) || value.effects.length > 64
    || !value.effects.every(completeEffect)) return null;
  try {
    const parsed = parseLayerStyleStack({ ...structuredClone(value), revision: 0 });
    return layerStyleSnapshot(parsed);
  } catch {
    return null;
  }
};

export const materializeLayerStyleSnapshot = (
  snapshot: LayerStyleSnapshot,
  revision: number
): LayerStyleStack => ({ ...structuredClone(snapshot), revision });
