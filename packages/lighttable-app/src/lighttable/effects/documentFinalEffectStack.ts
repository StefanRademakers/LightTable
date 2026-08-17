import type {
  AdjustmentLayer,
  ImageDocument,
  LayerNode
} from '../editor/document/documentTypes';
import {
  adjustmentStackHasOwner,
  cloneAdjustmentStack,
  type AdjustmentModuleInstance,
  type AdjustmentStack
} from '../processing/adjustmentStack';
import { currentDocumentEffectNodeRegistry } from './documentEffectNodeRegistry';

const EFFECT_STAGE_ORDER = {
  'source-geometry': 0,
  'linear-spatial': 1,
  'display-post': 2
} as const;

/** Lens FX adjustment layers are document-final control layers, not pixels. */
export const adjustmentLayerOwnsDocumentFinalEffects = (
  layer: AdjustmentLayer
): boolean => adjustmentStackHasOwner(layer.adjustmentStack, 'lens-fx');

/**
 * A pristine Lens FX control layer can use the stage-aware document-final
 * runtime. Once ordinary layer compositing participates, keep it in the layer
 * compositor so opacity, masks, clipping and blend mode remain authoritative.
 */
export const adjustmentLayerUsesDocumentFinalEffects = (
  layer: AdjustmentLayer
): boolean => adjustmentLayerOwnsDocumentFinalEffects(layer)
  && layer.opacity >= 0.99999
  && layer.blendMode === 'normal'
  && !layer.clipping
  && (!layer.mask || (
    layer.mask.enabled
    && layer.mask.pixelRevision === 0
    && layer.mask.density >= 0.99999
    && layer.mask.feather <= 0.01
  ));

const visibleDocumentFinalModules = (
  nodes: readonly LayerNode[],
  ancestorsVisible = true
): AdjustmentModuleInstance[] => nodes.flatMap((node) => {
  const visible = ancestorsVisible && node.visible;
  if (!visible) return [];
  if (node.type === 'group') {
    return visibleDocumentFinalModules(node.children, visible);
  }
  if (node.type !== 'adjustment' || !adjustmentLayerUsesDocumentFinalEffects(node)) {
    return [];
  }
  return cloneAdjustmentStack(node.adjustmentStack).modules.filter((module) =>
    currentDocumentEffectNodeRegistry.definition(module.type)
  );
});

/**
 * Combines hidden document processing with visible Lens FX control layers.
 *
 * The stage sort is intentional: a Lens FX layer is one logical final pass,
 * while its internal nodes still execute in their required texture domains.
 */
export const composeDocumentFinalEffectStack = (
  base: AdjustmentStack,
  document: ImageDocument | null
): AdjustmentStack => {
  const clonedBase = cloneAdjustmentStack(base);
  if (!document) return clonedBase;
  const baseEffects = clonedBase.modules.filter((module) =>
    currentDocumentEffectNodeRegistry.definition(module.type)
  );
  const nonEffects = clonedBase.modules.filter((module) =>
    !currentDocumentEffectNodeRegistry.definition(module.type)
  );
  const effects = [...baseEffects, ...visibleDocumentFinalModules(document.layers)]
    .map((module, order) => ({ module, order }))
    .sort((left, right) => {
      const leftStage = currentDocumentEffectNodeRegistry.definition(left.module.type)?.stage;
      const rightStage = currentDocumentEffectNodeRegistry.definition(right.module.type)?.stage;
      return (leftStage ? EFFECT_STAGE_ORDER[leftStage] : 0)
        - (rightStage ? EFFECT_STAGE_ORDER[rightStage] : 0)
        || left.order - right.order;
    })
    .map(({ module }) => module);
  return {
    id: `${clonedBase.id}:document-final`,
    revision: clonedBase.revision + effects.reduce((sum, module) => sum + module.revision, 0),
    modules: [...nonEffects, ...effects]
  };
};
