import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import {
  adjustmentStackForOwner,
  createAdjustmentStackFromBasicAdjustments,
  type AdjustmentModuleInstance,
  type AdjustmentStack
} from '../../processing/adjustmentStack';
import { currentProcessingModuleRegistry } from '../../processing/processingModuleRegistry';
import type { CurrentAdjustmentSettingsPath } from '../../processing/moduleDefinitions';
import { createDefaultAdjustments, type BasicAdjustments } from '../../types';
import type { PhotoshopAdjustmentKind } from '../../photoshopAdjustments';
import { MAX_POINT_COLOR_SAMPLES } from '../../pointColor';
import {
  defaultFilterSettings,
  filterDefinitionForModule
} from '@lighttable/filter-core';

export type AdjustmentQueryTarget =
  | { readonly kind: 'document'; readonly owner: 'grade' | 'lens-fx' }
  | { readonly kind: 'layer'; readonly layerId: LayerId }
  | { readonly kind: 'attached'; readonly layerId: LayerId; readonly adjustmentId: string };

export type AdjustmentJsonValue = null | boolean | number | string
  | readonly AdjustmentJsonValue[] | { readonly [key: string]: AdjustmentJsonValue };

export interface AdjustmentParameterProjection {
  readonly path: string;
  readonly value: AdjustmentJsonValue;
  readonly defaultValue: AdjustmentJsonValue;
  readonly state: 'default' | 'non-default';
  readonly truncated: boolean;
}

export interface AdjustmentModuleProjection {
  readonly id: string;
  readonly type: string;
  readonly label: string;
  readonly category: string;
  readonly enabled: boolean;
  readonly revision: number;
  readonly valueState: 'default' | 'non-default';
  readonly parameters: readonly AdjustmentParameterProjection[];
}

export interface AdjustmentQueryCompleted {
  readonly status: 'completed';
  readonly documentId: string;
  readonly documentRevision: number;
  readonly targetRevision: number;
  readonly target: AdjustmentQueryTarget;
  readonly adjustmentKind: string;
  readonly stack: {
    readonly id: string;
    readonly revision: number;
    readonly totalModules: number;
    readonly truncated: boolean;
    readonly modules: readonly AdjustmentModuleProjection[];
  };
}

export interface AdjustmentQueryRejected {
  readonly status: 'rejected';
  readonly code: 'invalid-request' | 'stale-document-revision' | 'target-not-found'
    | 'unsupported-target';
  readonly message: string;
  readonly currentRevision?: number;
}

export type AdjustmentQueryResult = AdjustmentQueryCompleted | AdjustmentQueryRejected;

const MAX_MODULES = 128;
const MAX_ARRAY_ITEMS = 64;
const MAX_OBJECT_KEYS = 64;
const MAX_DEPTH = 8;

const record = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

export const parseAdjustmentQueryTarget = (
  value: unknown
): AdjustmentQueryTarget | { readonly message: string } => {
  if (!record(value)) return { message: 'Adjustment query requires an explicit target.' };
  if (value.kind === 'document' && (value.owner === 'grade' || value.owner === 'lens-fx')
    && Object.keys(value).every((key) => key === 'kind' || key === 'owner')) {
    return { kind: 'document', owner: value.owner };
  }
  if (value.kind === 'layer' && typeof value.layerId === 'string' && value.layerId
    && value.layerId.length <= 512
    && Object.keys(value).every((key) => key === 'kind' || key === 'layerId')) {
    return { kind: 'layer', layerId: value.layerId as LayerId };
  }
  if (value.kind === 'attached' && typeof value.layerId === 'string' && value.layerId
    && value.layerId.length <= 512 && typeof value.adjustmentId === 'string'
    && value.adjustmentId && value.adjustmentId.length <= 512
    && Object.keys(value).every((key) => (
      key === 'kind' || key === 'layerId' || key === 'adjustmentId'
    ))) {
    return { kind: 'attached', layerId: value.layerId as LayerId,
      adjustmentId: value.adjustmentId };
  }
  return { message: 'Adjustment target must identify document processing, one layer, or one attached adjustment.' };
};

const readDefault = (defaults: BasicAdjustments, path: CurrentAdjustmentSettingsPath): unknown => {
  if (path.startsWith('effects.')) {
    return defaults.effects[path.slice('effects.'.length) as keyof BasicAdjustments['effects']];
  }
  return defaults[path as Exclude<CurrentAdjustmentSettingsPath, `effects.${string}`>];
};

const PHOTOSHOP_FIELDS: Readonly<Record<PhotoshopAdjustmentKind, readonly string[]>> = {
  'brightness-contrast': ['kind', 'brightness', 'contrast', 'useLegacyBrightnessContrast'],
  levels: ['kind', 'levelsChannel', 'levels'],
  exposure: ['kind', 'exposure', 'exposureOffset', 'exposureGamma'],
  vibrance: ['kind', 'vibrance', 'vibranceSaturation'],
  'color-vibrance': ['kind', 'colorVibranceTemperature', 'colorVibranceTint',
    'colorVibranceVibrance', 'colorVibranceSaturation'],
  'hue-saturation': ['kind', 'hue', 'hueSaturation', 'hueLightness', 'colorize',
    'hueSaturationChannel', 'hueSaturationRanges'],
  'color-balance': ['kind', 'colorBalanceTone', 'colorBalanceShadows',
    'colorBalanceMidtones', 'colorBalanceHighlights', 'preserveLuminosity'],
  'black-white': ['kind', 'blackWhiteMix', 'blackWhiteTint', 'blackWhiteTintColor'],
  'photo-filter': ['kind', 'photoFilterColor', 'photoFilterDensity'],
  'channel-mixer': ['kind', 'channelMixerOutput', 'channelMixerRed',
    'channelMixerGreen', 'channelMixerBlue', 'channelMixerMonochrome'],
  'color-lookup': ['kind', 'colorLookupPreset', 'colorLookupAssetId'],
  'selective-color': ['kind', 'selectiveColorRange', 'selectiveColorValues',
    'selectiveColorMethod'],
  invert: ['kind'],
  posterize: ['kind', 'posterizeLevels'],
  threshold: ['kind', 'thresholdLevel']
};

interface BoundedValue { readonly value: AdjustmentJsonValue; readonly truncated: boolean }

const boundedValue = (candidate: unknown, shape: unknown, depth = 0): BoundedValue => {
  if (depth >= MAX_DEPTH) return { value: null, truncated: true };
  if (shape === null) {
    if (candidate === null || candidate === undefined) return { value: null, truncated: false };
    if (typeof candidate === 'string') return { value: candidate.slice(0, 1024),
      truncated: candidate.length > 1024 };
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return { value: candidate, truncated: false };
    }
    if (typeof candidate === 'boolean') return { value: candidate, truncated: false };
    return { value: null, truncated: true };
  }
  if (typeof shape === 'number') return {
    value: typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : shape,
    truncated: false
  };
  if (typeof shape === 'boolean') return {
    value: typeof candidate === 'boolean' ? candidate : shape, truncated: false
  };
  if (typeof shape === 'string') return {
    value: typeof candidate === 'string' ? candidate.slice(0, 1024) : shape,
    truncated: typeof candidate === 'string' && candidate.length > 1024
  };
  if (Array.isArray(shape)) {
    const source = Array.isArray(candidate) ? candidate : shape;
    const itemShape = shape[0] ?? null;
    const output: AdjustmentJsonValue[] = [];
    let truncated = source.length > MAX_ARRAY_ITEMS;
    for (const item of source.slice(0, MAX_ARRAY_ITEMS)) {
      const projected = boundedValue(item, itemShape, depth + 1);
      output.push(projected.value); truncated ||= projected.truncated;
    }
    return { value: output, truncated };
  }
  if (record(shape)) {
    const source = record(candidate) ? candidate : shape;
    const keys = Object.keys(shape).slice(0, MAX_OBJECT_KEYS);
    const output: Record<string, AdjustmentJsonValue> = {};
    let truncated = Object.keys(shape).length > MAX_OBJECT_KEYS;
    for (const key of keys) {
      const projected = boundedValue(source[key], shape[key], depth + 1);
      output[key] = projected.value; truncated ||= projected.truncated;
    }
    return { value: output, truncated };
  }
  return { value: null, truncated: true };
};

const photoshopValue = (candidate: unknown, defaultValue: unknown,
  requestedKind?: PhotoshopAdjustmentKind): BoundedValue => {
  const fallback = record(defaultValue) ? defaultValue : {};
  const source: Record<string, unknown> = record(candidate) ? candidate : fallback;
  const rawKind = source.kind;
  const kind = requestedKind ?? (typeof rawKind === 'string' && rawKind in PHOTOSHOP_FIELDS
    ? rawKind as PhotoshopAdjustmentKind : 'brightness-contrast');
  const output: Record<string, AdjustmentJsonValue> = {};
  let truncated = false;
  for (const key of PHOTOSHOP_FIELDS[kind]) {
    const projected = boundedValue(source[key], fallback[key], 1);
    output[key] = key === 'kind' ? kind : projected.value;
    truncated ||= projected.truncated;
  }
  return { value: output, truncated };
};

const pointColorValue = (candidate: unknown): BoundedValue => {
  const samples = record(candidate) && Array.isArray(candidate.samples) ? candidate.samples : [];
  const projected = boundedValue({ samples: samples.slice(0, MAX_POINT_COLOR_SAMPLES) }, {
    samples: [{ id: '', lightness: 0, chroma: 0, hue: 0, hueShift: 0,
    saturationShift: 0, luminanceShift: 0, variance: 0, range: 50,
    hueRange: 50, saturationRange: 50, luminanceRange: 50 }]
  });
  return { value: projected.value,
    truncated: projected.truncated || samples.length > MAX_POINT_COLOR_SAMPLES };
};

const projectParameter = (module: AdjustmentModuleInstance,
  path: CurrentAdjustmentSettingsPath, defaults: BasicAdjustments): AdjustmentParameterProjection => {
  const defaultSource = readDefault(defaults, path);
  const source = Object.prototype.hasOwnProperty.call(module.settings, path)
    ? module.settings[path] : defaultSource;
  const photoshopKind = path === 'photoshopAdjustment' && record(source)
    && typeof source.kind === 'string' && source.kind in PHOTOSHOP_FIELDS
    ? source.kind as PhotoshopAdjustmentKind : undefined;
  const projected = path === 'photoshopAdjustment'
    ? photoshopValue(source, defaultSource, photoshopKind)
    : path === 'pointColor' ? pointColorValue(source) : boundedValue(source, defaultSource);
  const projectedDefault = path === 'photoshopAdjustment'
    ? photoshopValue(defaultSource, defaultSource, photoshopKind)
    : path === 'pointColor' ? { value: { samples: [] } as AdjustmentJsonValue, truncated: false }
      : boundedValue(defaultSource, defaultSource);
  const state = JSON.stringify(projected.value) === JSON.stringify(projectedDefault.value)
    ? 'default' : 'non-default';
  return { path, value: projected.value, defaultValue: projectedDefault.value,
    state, truncated: projected.truncated };
};

const projectStack = (stack: AdjustmentStack) => {
  const defaults = createDefaultAdjustments();
  const supported = stack.modules.filter((module) => (
    (currentProcessingModuleRegistry.definition(module.type)?.settingsPaths.length ?? 0) > 0
    || Boolean(filterDefinitionForModule(module.type))
  ));
  const modules = supported.slice(0, MAX_MODULES).map((module): AdjustmentModuleProjection => {
    const definition = currentProcessingModuleRegistry.definition(module.type)!;
    const filter = filterDefinitionForModule(module.type);
    const parameters: AdjustmentParameterProjection[] = filter
      ? Object.entries(defaultFilterSettings(filter.kind)).map(([path, defaultValue]) => {
          const projected = boundedValue(module.settings[path], defaultValue);
          const projectedDefault = boundedValue(defaultValue, defaultValue);
          return {
            path,
            value: projected.value,
            defaultValue: projectedDefault.value,
            state: JSON.stringify(projected.value) === JSON.stringify(projectedDefault.value)
              ? 'default' : 'non-default',
            truncated: projected.truncated
          };
        })
      : definition.settingsPaths.map((path) => projectParameter(module, path, defaults));
    return { id: module.id, type: module.type, label: definition.label,
      category: definition.category, enabled: module.enabled, revision: module.revision,
      valueState: parameters.some(({ state }) => state === 'non-default') ? 'non-default' : 'default',
      parameters };
  });
  return { id: stack.id, revision: stack.revision, totalModules: supported.length,
    truncated: supported.length > MAX_MODULES, modules };
};

const documentStack = (adjustments: BasicAdjustments, owner: 'grade' | 'lens-fx') => {
  let sequence = 0;
  return adjustmentStackForOwner(createAdjustmentStackFromBasicAdjustments(
    adjustments, undefined, (kind) => `document-${owner}-${kind}-${sequence += 1}`
  ), owner);
};

export const projectAdjustmentQuery = (
  documentId: string,
  document: ImageDocument,
  documentAdjustments: BasicAdjustments,
  documentRevision: number,
  target: AdjustmentQueryTarget
): AdjustmentQueryResult => {
  if (target.kind === 'document') {
    const stack = documentStack(documentAdjustments, target.owner);
    return { status: 'completed', documentId, documentRevision,
      targetRevision: documentRevision, target, adjustmentKind: target.owner,
      stack: projectStack(stack) };
  }
  const layer = findDocumentLayer(document, target.layerId);
  if (!layer) return { status: 'rejected', code: 'target-not-found',
    message: 'The adjustment owner layer does not exist.' };
  if (target.kind === 'attached') {
    if (layer.type !== 'raster') return { status: 'rejected', code: 'unsupported-target',
      message: 'Only raster layers can own attached adjustments.' };
    const adjustment = (layer.attachedAdjustments ?? []).find(({ id }) => id === target.adjustmentId);
    if (!adjustment) return { status: 'rejected', code: 'target-not-found',
      message: 'The attached adjustment does not exist.' };
    return { status: 'completed', documentId, documentRevision,
      targetRevision: adjustment.revision, target, adjustmentKind: adjustment.adjustmentKind,
      stack: projectStack(adjustment.adjustmentStack) };
  }
  if (layer.type !== 'raster' && layer.type !== 'adjustment') {
    return { status: 'rejected', code: 'unsupported-target',
      message: 'Only raster and adjustment layers expose processing adjustments.' };
  }
  const stack = layer.adjustmentStack;
  if (!stack) return { status: 'completed', documentId, documentRevision,
    targetRevision: layer.revision, target, adjustmentKind: 'raster-processing',
    stack: { id: `layer-${layer.id}-empty`, revision: 0, totalModules: 0,
      truncated: false, modules: [] } };
  return { status: 'completed', documentId, documentRevision,
    targetRevision: layer.revision, target,
    adjustmentKind: layer.type === 'adjustment'
      ? layer.adjustmentKind ?? 'adjustment' : 'raster-processing',
    stack: projectStack(stack) };
};
