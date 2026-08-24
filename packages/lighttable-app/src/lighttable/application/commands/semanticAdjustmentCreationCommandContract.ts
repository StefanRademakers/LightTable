import { findDocumentLayer } from '../../editor/document/layerTree';
import { layerIsLocked, type ImageDocument, type LayerId } from '../../editor/document/documentTypes';
import {
  adjustmentLayerMenuDefinitionGroups,
  type AdjustmentInitialSettings,
  type AdjustmentLayerKind
} from '../../processing/adjustmentLayerCatalog';
import type { LocalProcessingKind } from '../../processing/adjustmentStack';

const visibleKinds = adjustmentLayerMenuDefinitionGroups().flat().map(({ id }) => id);
const visibleKindSet = new Set<string>(visibleKinds);
const localKindSet = new Set<string>(['grade', 'curves', 'lens-fx']);

export type SemanticAdjustmentCreationCommand =
  | { readonly kind: LocalProcessingKind; readonly placement: 'local'; readonly layerId: LayerId }
  | { readonly kind: AdjustmentLayerKind; readonly placement: 'attached'; readonly layerId: LayerId;
      readonly settings?: AdjustmentInitialSettings }
  | { readonly kind: AdjustmentLayerKind; readonly placement: 'adjustment-layer'; readonly aboveLayerId?: LayerId;
      readonly settings?: AdjustmentInitialSettings };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isUnit = (value: unknown): value is number => typeof value === 'number'
  && Number.isFinite(value) && value >= 0 && value <= 1;
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
// The current GPU adjustment uniform has eight slots for each stop family.
// Reject overflow at the command boundary instead of silently truncating it.
const MAX_GRADIENT_MAP_STOPS = 8;

const parseGradientMapSettings = (value: Record<string, unknown>) => {
  if (!exactKeys(value, ['colorStops', 'opacityStops', 'reverse', 'dither', 'interpolation'])
    || !Array.isArray(value.colorStops) || value.colorStops.length < 2
    || value.colorStops.length > MAX_GRADIENT_MAP_STOPS || !Array.isArray(value.opacityStops)
    || value.opacityStops.length < 2 || value.opacityStops.length > MAX_GRADIENT_MAP_STOPS
    || (value.reverse !== undefined && typeof value.reverse !== 'boolean')
    || (value.dither !== undefined && typeof value.dither !== 'boolean')
    || (value.interpolation !== undefined
      && !['classic', 'perceptual', 'linear', 'smooth'].includes(String(value.interpolation)))) return null;
  const colorStops = value.colorStops.map((stop) => {
    if (!isRecord(stop) || !exactKeys(stop, ['position', 'midpoint', 'color'])
      || !isUnit(stop.position) || !isUnit(stop.midpoint) || !isRecord(stop.color)
      || !exactKeys(stop.color, ['r', 'g', 'b']) || !isUnit(stop.color.r)
      || !isUnit(stop.color.g) || !isUnit(stop.color.b)) return null;
    return { position: stop.position, midpoint: stop.midpoint,
      color: { r: stop.color.r, g: stop.color.g, b: stop.color.b } };
  });
  const opacityStops = value.opacityStops.map((stop) => {
    if (!isRecord(stop) || !exactKeys(stop, ['position', 'midpoint', 'opacity'])
      || !isUnit(stop.position) || !isUnit(stop.midpoint) || !isUnit(stop.opacity)) return null;
    return { position: stop.position, midpoint: stop.midpoint, opacity: stop.opacity };
  });
  if (colorStops.includes(null) || opacityStops.includes(null)) return null;
  return {
    colorStops: colorStops as Exclude<(typeof colorStops)[number], null>[],
    opacityStops: opacityStops as Exclude<(typeof opacityStops)[number], null>[],
    ...(value.reverse === undefined ? {} : { reverse: value.reverse }),
    ...(value.dither === undefined ? {} : { dither: value.dither }),
    ...(value.interpolation === undefined ? {} : {
      interpolation: value.interpolation as 'classic' | 'perceptual' | 'linear' | 'smooth'
    })
  };
};

const parseInitialSettings = (kind: string, value: unknown) => {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return null;
  if (kind === 'posterize' && Object.keys(value).length === 1
    && Number.isInteger(value.posterizeLevels)
    && Number(value.posterizeLevels) >= 2 && Number(value.posterizeLevels) <= 255) {
    return { posterizeLevels: Number(value.posterizeLevels) };
  }
  if (kind === 'threshold' && Object.keys(value).length === 1
    && Number.isInteger(value.thresholdLevel)
    && Number(value.thresholdLevel) >= 1 && Number(value.thresholdLevel) <= 255) {
    return { thresholdLevel: Number(value.thresholdLevel) };
  }
  if (kind === 'gradient-map') return parseGradientMapSettings(value);
  return null;
};

export const parseSemanticAdjustmentCreationCommand = (
  value: unknown
): SemanticAdjustmentCreationCommand | { readonly message: string } => {
  if (!isRecord(value) || typeof value.kind !== 'string' || !visibleKindSet.has(value.kind)
    || (value.placement !== 'local' && value.placement !== 'attached'
      && value.placement !== 'adjustment-layer')) {
    return { message: 'Adjustment creation requires a visible kind and supported placement.' };
  }
  const allowedKeys = value.placement === 'adjustment-layer'
    ? new Set(['kind', 'placement', 'aboveLayerId', 'settings'])
    : new Set(['kind', 'placement', 'layerId', 'settings']);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    return { message: 'Adjustment creation contains unsupported target fields.' };
  }
  if (value.placement === 'local') {
    if (value.settings !== undefined) {
      return { message: 'Local adjustment creation does not accept initial settings.' };
    }
    if (!localKindSet.has(value.kind) || typeof value.layerId !== 'string') {
      return { message: 'Local placement requires Grade, Curves or Lens Fx and a layerId.' };
    }
    return { kind: value.kind as LocalProcessingKind, placement: value.placement,
      layerId: value.layerId as LayerId };
  }
  const settings = parseInitialSettings(value.kind, value.settings);
  if (settings === null) {
    return { message: 'Initial settings do not match the requested adjustment kind.' };
  }
  if (value.placement === 'attached') {
    if (typeof value.layerId !== 'string') {
      return { message: 'Attached placement requires a layerId.' };
    }
    return { kind: value.kind as AdjustmentLayerKind, placement: value.placement,
      layerId: value.layerId as LayerId, ...(settings ? { settings } : {}) };
  }
  if (value.aboveLayerId !== undefined && typeof value.aboveLayerId !== 'string') {
    return { message: 'Adjustment-layer placement requires a valid optional aboveLayerId.' };
  }
  return { kind: value.kind as AdjustmentLayerKind, placement: value.placement,
    ...(settings ? { settings } : {}),
    ...(typeof value.aboveLayerId === 'string'
      ? { aboveLayerId: value.aboveLayerId as LayerId } : {}) };
};

/** Resolve transient menu context once so recorded Actions retain stable targets. */
export const resolveContextualAdjustmentCreation = (
  document: ImageDocument,
  kind: AdjustmentLayerKind
): SemanticAdjustmentCreationCommand => {
  const active = findDocumentLayer(document, document.activeLayerId);
  if (active?.type === 'raster' && !layerIsLocked(active, 'pixels')) {
    return localKindSet.has(kind)
      ? { kind: kind as LocalProcessingKind, placement: 'local', layerId: active.id }
      : { kind, placement: 'attached', layerId: active.id };
  }
  return { kind, placement: 'adjustment-layer',
    ...(active ? { aboveLayerId: active.id } : {}) };
};
