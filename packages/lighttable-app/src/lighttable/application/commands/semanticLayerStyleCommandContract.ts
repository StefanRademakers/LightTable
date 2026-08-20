import type { LayerStyleInstance, LayerStyleKind } from '../../editor/styles/layerStyleTypes';

export type SemanticLayerStyleCommand =
  | { readonly kind: 'stack-update'; readonly layerId: string;
      readonly settings: { readonly scale?: number;
        readonly globalLight?: { readonly angle: number; readonly altitude: number } } }
  | { readonly kind: 'add'; readonly layerId: string; readonly effectKind: LayerStyleKind;
      readonly settings?: Readonly<Record<string, unknown>> }
  | { readonly kind: 'update'; readonly layerId: string; readonly effectId: string;
      readonly settings: Readonly<Record<string, unknown>> }
  | { readonly kind: 'remove'; readonly layerId: string; readonly effectId: string }
  | { readonly kind: 'move'; readonly layerId: string; readonly effectId: string; readonly targetIndex: number }
  | { readonly kind: 'toggle'; readonly layerId: string; readonly effectId: string; readonly enabled: boolean };

const KINDS: readonly LayerStyleKind[] = ['drop-shadow', 'inner-shadow', 'outer-glow', 'inner-glow',
  'bevel-emboss', 'color-overlay', 'gradient-overlay', 'pattern-overlay', 'satin', 'stroke'];
const COMMON_SETTING_KEYS = ['name', 'enabled', 'blendMode', 'opacity'] as const;
const SETTING_KEYS: Readonly<Record<LayerStyleKind, readonly string[]>> = {
  'drop-shadow': [...COMMON_SETTING_KEYS, 'color', 'useGlobalLight', 'angle', 'distance',
    'contour', 'antiAlias', 'noise', 'spread', 'size', 'layerKnocksOut'],
  'inner-shadow': [...COMMON_SETTING_KEYS, 'color', 'useGlobalLight', 'angle', 'distance',
    'contour', 'antiAlias', 'noise', 'choke', 'size'],
  'outer-glow': [...COMMON_SETTING_KEYS, 'color', 'gradient', 'technique', 'choke', 'size',
    'contour', 'antiAlias', 'noise', 'range', 'jitter'],
  'inner-glow': [...COMMON_SETTING_KEYS, 'color', 'gradient', 'technique', 'choke', 'size',
    'contour', 'antiAlias', 'noise', 'range', 'jitter', 'source'],
  'bevel-emboss': [...COMMON_SETTING_KEYS, 'style', 'technique', 'depth', 'direction', 'size',
    'soften', 'useGlobalLight', 'angle', 'altitude', 'contour', 'antiAlias', 'noise',
    'highlightMode', 'highlightColor', 'highlightOpacity', 'shadowMode', 'shadowColor',
    'shadowOpacity', 'texture'],
  'color-overlay': [...COMMON_SETTING_KEYS, 'color'],
  'gradient-overlay': [...COMMON_SETTING_KEYS, 'gradient', 'dither', 'reverse', 'style',
    'alignWithLayer', 'angle', 'scale', 'offsetX', 'offsetY', 'method'],
  'pattern-overlay': [...COMMON_SETTING_KEYS, 'pattern', 'angle', 'scale', 'linkWithLayer',
    'offsetX', 'offsetY'],
  satin: [...COMMON_SETTING_KEYS, 'color', 'useGlobalLight', 'angle', 'distance', 'size',
    'contour', 'antiAlias', 'invert'],
  stroke: [...COMMON_SETTING_KEYS, 'size', 'position', 'overprint', 'fill']
};
const record = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);
const id = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 255;

const boundedSettings = (value: unknown): value is Readonly<Record<string, unknown>> => {
  if (!record(value) || Object.keys(value).length < 1) return false;
  let count = 0;
  const visit = (candidate: unknown, depth: number): boolean => {
    count += 1;
    if (count > 2048 || depth > 12) return false;
    if (typeof candidate === 'number') return Number.isFinite(candidate);
    if (typeof candidate === 'string') return candidate.length <= 1024;
    if (candidate === null || typeof candidate === 'boolean' || candidate === undefined) return true;
    if (Array.isArray(candidate)) return candidate.length <= 64 && candidate.every((entry) => visit(entry, depth + 1));
    return record(candidate) && Object.keys(candidate).length <= 64
      && Object.values(candidate).every((entry) => visit(entry, depth + 1));
  };
  return visit(value, 0);
};

export const layerStyleSettingsMatchKind = (
  kind: LayerStyleKind,
  settings: Readonly<Record<string, unknown>> | undefined
): boolean => settings === undefined || Object.keys(settings).every((key) => SETTING_KEYS[kind].includes(key));

const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every((key) => keys.includes(key));

export const parseSemanticLayerStyleCommand = (
  kind: SemanticLayerStyleCommand['kind'], value: unknown
): SemanticLayerStyleCommand | { readonly message: string } => {
  if (!record(value) || !id(value.layerId)) return { message: 'Layer Style commands require a valid layerId.' };
  if (kind === 'stack-update') {
    const settings = value.settings;
    if (!exactKeys(value, ['layerId', 'settings']) || !record(settings)
      || Object.keys(settings).length < 1 || !exactKeys(settings, ['scale', 'globalLight'])
      || (settings.scale !== undefined && (typeof settings.scale !== 'number'
        || !Number.isFinite(settings.scale) || settings.scale < 0.01 || settings.scale > 10))
      || (settings.globalLight !== undefined && (!record(settings.globalLight)
        || !exactKeys(settings.globalLight, ['angle', 'altitude'])
        || typeof settings.globalLight.angle !== 'number' || !Number.isFinite(settings.globalLight.angle)
        || settings.globalLight.angle < 0 || settings.globalLight.angle > 359
        || typeof settings.globalLight.altitude !== 'number' || !Number.isFinite(settings.globalLight.altitude)
        || settings.globalLight.altitude < 0 || settings.globalLight.altitude > 90))) {
      return { message: 'The Layer Styles stack settings are invalid.' };
    }
  } else if (kind === 'add') {
    const effectKind = value.effectKind as LayerStyleKind;
    if (!exactKeys(value, ['layerId', 'effectKind', 'settings']) || !KINDS.includes(effectKind)
      || (value.settings !== undefined && (!boundedSettings(value.settings)
        || !layerStyleSettingsMatchKind(effectKind, value.settings)))) {
      return { message: 'The Layer Style kind or settings are invalid.' };
    }
  } else if (!id(value.effectId)) return { message: 'The Layer Style effectId is invalid.' };
  else if (kind === 'update' && (!exactKeys(value, ['layerId', 'effectId', 'settings'])
    || !boundedSettings(value.settings))) return { message: 'The Layer Style settings are invalid.' };
  else if (kind === 'remove' && !exactKeys(value, ['layerId', 'effectId'])) {
    return { message: 'The Layer Style remove parameters are invalid.' };
  } else if (kind === 'move' && (!exactKeys(value, ['layerId', 'effectId', 'targetIndex'])
    || !Number.isInteger(value.targetIndex) || Number(value.targetIndex) < 0 || Number(value.targetIndex) > 63)) {
    return { message: 'The Layer Style target index is invalid.' };
  } else if (kind === 'toggle' && (!exactKeys(value, ['layerId', 'effectId', 'enabled'])
    || typeof value.enabled !== 'boolean')) return { message: 'Layer Style enabled must be boolean.' };
  return structuredClone({ ...value, kind }) as SemanticLayerStyleCommand;
};

/** Keeps identity/type immutable while allowing transport-safe canonical settings. */
export const mergeLayerStyleSettings = (
  effect: LayerStyleInstance, settings: Readonly<Record<string, unknown>> | undefined
): unknown => ({ ...structuredClone(effect), ...structuredClone(settings ?? {}), id: effect.id, kind: effect.kind });
