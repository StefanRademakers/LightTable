import type {
  AdjustmentLayer,
  ImageDocument
} from '../editor/document/documentTypes';
import {
  adjustmentStackHasOwner,
  cloneAdjustmentStack,
  type AdjustmentStack
} from '../processing/adjustmentStack';
import { currentDocumentEffectNodeRegistry } from './documentEffectNodeRegistry';

const EFFECT_STAGE_ORDER = {
  'source-geometry': 0,
  'linear-spatial': 1,
  'display-post': 2
} as const;

/** Identifies Lens FX ownership without implying any scheduling position. */
export const adjustmentLayerOwnsDocumentFinalEffects = (
  layer: AdjustmentLayer
): boolean => adjustmentStackHasOwner(layer.adjustmentStack, 'lens-fx');

/**
 * A pristine Lens FX control layer can use the stage-aware document-final
 * runtime. Once ordinary layer compositing participates, keep it in the layer
 * compositor so opacity, masks, clipping and blend mode remain authoritative.
 */
/**
 * Orders only the legacy document-owned effect stack. Visible Grade and Lens
 * FX layers are never collected here: their exact tree position, masks and
 * blending are authoritative and are evaluated by LayerCompositor.
 */
export const composeDocumentFinalEffectStack = (
  base: AdjustmentStack,
  _document: ImageDocument | null
): AdjustmentStack => {
  const clonedBase = cloneAdjustmentStack(base);
  const baseEffects = clonedBase.modules.filter((module) =>
    currentDocumentEffectNodeRegistry.definition(module.type)
  );
  const nonEffects = clonedBase.modules.filter((module) =>
    !currentDocumentEffectNodeRegistry.definition(module.type)
  );
  const effects = baseEffects
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
