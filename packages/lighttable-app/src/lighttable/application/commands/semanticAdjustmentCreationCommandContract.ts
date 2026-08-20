import { findDocumentLayer } from '../../editor/document/layerTree';
import { layerIsLocked, type ImageDocument, type LayerId } from '../../editor/document/documentTypes';
import {
  adjustmentLayerMenuDefinitionGroups,
  type AdjustmentLayerKind
} from '../../processing/adjustmentLayerCatalog';
import type { LocalProcessingKind } from '../../processing/adjustmentStack';

const visibleKinds = adjustmentLayerMenuDefinitionGroups().flat().map(({ id }) => id);
const visibleKindSet = new Set<string>(visibleKinds);
const localKindSet = new Set<string>(['grade', 'curves', 'lens-fx']);

export type SemanticAdjustmentCreationCommand =
  | { readonly kind: LocalProcessingKind; readonly placement: 'local'; readonly layerId: LayerId }
  | { readonly kind: AdjustmentLayerKind; readonly placement: 'attached'; readonly layerId: LayerId }
  | { readonly kind: AdjustmentLayerKind; readonly placement: 'adjustment-layer'; readonly aboveLayerId?: LayerId };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const parseSemanticAdjustmentCreationCommand = (
  value: unknown
): SemanticAdjustmentCreationCommand | { readonly message: string } => {
  if (!isRecord(value) || typeof value.kind !== 'string' || !visibleKindSet.has(value.kind)
    || (value.placement !== 'local' && value.placement !== 'attached'
      && value.placement !== 'adjustment-layer')) {
    return { message: 'Adjustment creation requires a visible kind and supported placement.' };
  }
  const allowedKeys = value.placement === 'adjustment-layer'
    ? new Set(['kind', 'placement', 'aboveLayerId'])
    : new Set(['kind', 'placement', 'layerId']);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    return { message: 'Adjustment creation contains unsupported target fields.' };
  }
  if (value.placement === 'local') {
    if (!localKindSet.has(value.kind) || typeof value.layerId !== 'string') {
      return { message: 'Local placement requires Grade, Curves or Lens Fx and a layerId.' };
    }
    return { kind: value.kind as LocalProcessingKind, placement: value.placement,
      layerId: value.layerId as LayerId };
  }
  if (value.placement === 'attached') {
    if (typeof value.layerId !== 'string') {
      return { message: 'Attached placement requires a layerId.' };
    }
    return { kind: value.kind as AdjustmentLayerKind, placement: value.placement,
      layerId: value.layerId as LayerId };
  }
  if (value.aboveLayerId !== undefined && typeof value.aboveLayerId !== 'string') {
    return { message: 'Adjustment-layer placement requires a valid optional aboveLayerId.' };
  }
  return { kind: value.kind as AdjustmentLayerKind, placement: value.placement,
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
