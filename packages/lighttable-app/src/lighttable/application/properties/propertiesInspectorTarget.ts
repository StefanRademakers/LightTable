import type { ImageDocument, LayerId, LayerNode } from '../../editor/document/documentTypes';
import { layerSupportsLayerStyles } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import type { LayerStyleId } from '../../editor/styles/layerStyleTypes';
import {
  adjustmentStackHasOwner,
  type AdjustmentStackOwner
} from '../../processing/adjustmentStack';

export type PropertiesInspectorTarget =
  | { readonly kind: 'none' }
  | { readonly kind: 'layer'; readonly layerId: LayerId }
  | { readonly kind: 'mask'; readonly layerId: LayerId }
  | {
      readonly kind: 'processing';
      readonly layerId: LayerId;
      readonly owner: Extract<AdjustmentStackOwner, 'grade' | 'lens-fx'>;
    }
  | { readonly kind: 'style-stack'; readonly layerId: LayerId }
  | {
      readonly kind: 'style';
      readonly layerId: LayerId;
      readonly effectId: LayerStyleId;
    };

export type PropertiesInspectorView =
  | 'empty'
  | 'grade'
  | 'lens-fx'
  | 'effects'
  | 'text';

const stackFor = (layer: LayerNode) => (
  layer.type === 'raster' || layer.type === 'adjustment'
    ? layer.adjustmentStack
    : null
);

export const defaultPropertiesTargetForLayer = (
  layer: LayerNode | null
): PropertiesInspectorTarget => layer
  ? { kind: 'layer', layerId: layer.id }
  : { kind: 'none' };

export const propertiesTargetIsValid = (
  document: ImageDocument,
  target: PropertiesInspectorTarget
): boolean => {
  if (target.kind === 'none') return document.activeLayerId === null;
  const layer = findDocumentLayer(document, target.layerId);
  if (!layer || layer.id !== document.activeLayerId) return false;
  if (target.kind === 'layer') return true;
  if (target.kind === 'mask') return Boolean(layer.mask);
  if (target.kind === 'processing') {
    const stack = stackFor(layer);
    // Raster layers may open a neutral local editor before its first authored
    // module exists. The first mutation creates the canonical owner stack.
    return layer.type === 'raster'
      || Boolean(stack && adjustmentStackHasOwner(stack, target.owner));
  }
  if (!layerSupportsLayerStyles(layer)) return false;
  if (target.kind === 'style-stack') return true;
  return layer.styleStack.effects.some((effect) => effect.id === target.effectId);
};

export const reconcilePropertiesTarget = (
  document: ImageDocument | null,
  target: PropertiesInspectorTarget
): PropertiesInspectorTarget => {
  if (!document?.activeLayerId) return { kind: 'none' };
  if (propertiesTargetIsValid(document, target)) return target;
  return defaultPropertiesTargetForLayer(
    findDocumentLayer(document, document.activeLayerId)
  );
};

export const propertiesInspectorView = (
  document: ImageDocument | null,
  target: PropertiesInspectorTarget
): PropertiesInspectorView => {
  if (!document) return 'empty';
  const reconciled = reconcilePropertiesTarget(document, target);
  if (reconciled.kind === 'none' || reconciled.kind === 'mask') return 'empty';
  const layer = findDocumentLayer(document, reconciled.layerId);
  if (!layer) return 'empty';
  if (reconciled.kind === 'processing') return reconciled.owner;
  if (reconciled.kind === 'style' || reconciled.kind === 'style-stack') return 'effects';
  if (layer.type === 'text') return 'text';
  if (layer.type === 'raster') return 'grade';
  if (layer.type !== 'adjustment') return 'empty';
  const hasGrade = adjustmentStackHasOwner(layer.adjustmentStack, 'grade');
  const hasLensFx = adjustmentStackHasOwner(layer.adjustmentStack, 'lens-fx');
  return hasLensFx && !hasGrade ? 'lens-fx' : 'grade';
};
