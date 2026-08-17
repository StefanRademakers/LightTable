import type { ImageDocument, LayerId, LayerNode } from '../../editor/document/documentTypes';
import { layerSupportsLayerStyles } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import type { LayerStyleId } from '../../editor/styles/layerStyleTypes';
import {
  adjustmentStackHasLocalProcessing,
  type LocalProcessingKind
} from '../../processing/adjustmentStack';
import {
  adjustmentPropertiesViewForStack,
  type AdjustmentPropertiesView
} from '../../processing/adjustmentLayerCatalog';

export type PropertiesInspectorTarget =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'document-processing';
      readonly owner: 'grade' | 'lens-fx';
    }
  | { readonly kind: 'layer'; readonly layerId: LayerId }
  | { readonly kind: 'mask'; readonly layerId: LayerId }
  | {
      readonly kind: 'processing';
      readonly layerId: LayerId;
      readonly owner: LocalProcessingKind;
    }
  | {
      readonly kind: 'attached-processing';
      readonly layerId: LayerId;
      readonly adjustmentId: string;
    }
  | { readonly kind: 'style-stack'; readonly layerId: LayerId }
  | {
      readonly kind: 'style';
      readonly layerId: LayerId;
      readonly effectId: LayerStyleId;
    };

export type PropertiesInspectorView =
  | 'empty'
  | AdjustmentPropertiesView
  | 'effects'
  | 'text';

export type GradePropertiesTitle = 'Global Grade' | 'Grade Layer' | 'Local Grade';

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
  if (target.kind === 'document-processing') return true;
  const layer = findDocumentLayer(document, target.layerId);
  if (!layer || layer.id !== document.activeLayerId) return false;
  if (target.kind === 'layer') return true;
  if (target.kind === 'mask') return Boolean(layer.mask);
  if (target.kind === 'processing') {
    const stack = stackFor(layer);
    // Raster layers may open a neutral local editor before its first authored
    // module exists. The first mutation creates the canonical owner stack.
    return layer.type === 'raster'
      || Boolean(stack && adjustmentStackHasLocalProcessing(stack, target.owner));
  }
  if (target.kind === 'attached-processing') {
    return layer.type === 'raster'
      && (layer.attachedAdjustments ?? []).some(({ id }) => id === target.adjustmentId);
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
  if (reconciled.kind === 'document-processing') return reconciled.owner;
  const layer = findDocumentLayer(document, reconciled.layerId);
  if (!layer) return 'empty';
  if (reconciled.kind === 'processing') return reconciled.owner;
  if (reconciled.kind === 'attached-processing') {
    if (layer.type !== 'raster') return 'empty';
    return (layer.attachedAdjustments ?? [])
      .find(({ id }) => id === reconciled.adjustmentId)?.adjustmentKind ?? 'empty';
  }
  if (reconciled.kind === 'style' || reconciled.kind === 'style-stack') return 'effects';
  if (layer.type === 'text') return 'text';
  if (layer.type === 'raster') return 'grade';
  if (layer.type !== 'adjustment') return 'empty';
  return layer.adjustmentKind ?? adjustmentPropertiesViewForStack(layer.adjustmentStack);
};

/** Names the shared Grade editor by ownership, not by its control inventory. */
export const gradePropertiesTitle = (
  document: ImageDocument | null,
  target: PropertiesInspectorTarget
): GradePropertiesTitle => {
  if (!document) return 'Local Grade';
  const reconciled = reconcilePropertiesTarget(document, target);
  if (reconciled.kind === 'document-processing' && reconciled.owner === 'grade') {
    return 'Global Grade';
  }
  if (reconciled.kind === 'processing' && reconciled.owner === 'grade') {
    return 'Local Grade';
  }
  if ('layerId' in reconciled) {
    const layer = findDocumentLayer(document, reconciled.layerId);
    if (layer?.type === 'adjustment'
      && (layer.adjustmentKind ?? adjustmentPropertiesViewForStack(layer.adjustmentStack)) === 'grade') {
      return 'Grade Layer';
    }
  }
  return 'Local Grade';
};
