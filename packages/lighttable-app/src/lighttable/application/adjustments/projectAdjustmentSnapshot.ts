import {
  adjustmentModuleBelongsToOwner,
  adjustmentStackForScope,
  adjustmentStackHasOwner,
  adjustmentStackOwnerHasAuthoredSettings,
  createAdjustmentStackFromBasicAdjustments
} from '../../processing/adjustmentStack';
import { createDefaultAdjustments, type BasicAdjustments } from '../../types';
import type {
  ImageDocument,
  LayerId
} from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { setAdjustmentLayerStack } from '../../editor/document/documentCommands';
import { setRasterLayerAdjustmentStack } from '../../editor/document/documentCommands';

export interface AdjustmentProjectionInput {
  readonly snapshot: BasicAdjustments;
  readonly targetLayerId: LayerId | null;
  readonly document: ImageDocument | null;
  readonly documentAdjustments: BasicAdjustments;
}

export interface AdjustmentProjection {
  readonly editorAdjustments: BasicAdjustments;
  readonly documentAdjustments: BasicAdjustments;
  readonly document: ImageDocument | null;
  readonly scope: 'layer' | 'adjustment-layer';
}

/**
 * Projects Grade and Lens Fx onto their explicit layer owner.
 *
 * Both categories share the typed processing stack and layer ordering, but
 * presence and bypass remain independent. An untouched category is never
 * manufactured merely because the other category changed. Scope-valid
 * geometry nodes remain authored independently and survive color projection.
 */
export const projectAdjustmentSnapshot = ({
  snapshot,
  targetLayerId,
  document,
  documentAdjustments
}: AdjustmentProjectionInput): AdjustmentProjection => {
  const editorAdjustments = structuredClone(snapshot);
  if (!targetLayerId) {
    throw new Error('Select a raster layer or Grade Layer before grading.');
  }
  if (!document) {
    throw new Error('An Adjustment Layer grade requires an active document.');
  }
  const target = findDocumentLayer(document, targetLayerId);
  if (target?.type !== 'adjustment' && target?.type !== 'raster') {
    throw new Error('The selected layer cannot own a grade.');
  }
  const generatedStack = adjustmentStackForScope(
    createAdjustmentStackFromBasicAdjustments(
      editorAdjustments,
      target.adjustmentStack ?? undefined
    ),
    target.type === 'adjustment' ? 'adjustment-layer' : 'layer'
  );
  const scope = target.type === 'adjustment' ? 'adjustment-layer' : 'layer';
  const owners = (['grade', 'lens-fx'] as const).filter((owner) =>
    Boolean(target.adjustmentStack && adjustmentStackHasOwner(target.adjustmentStack, owner))
    || adjustmentStackOwnerHasAuthoredSettings(editorAdjustments, owner)
  );
  const preservedModules = target.adjustmentStack
    ? adjustmentStackForScope(target.adjustmentStack, scope).modules.filter((module) =>
        !adjustmentModuleBelongsToOwner(module.type, 'grade')
        && !adjustmentModuleBelongsToOwner(module.type, 'lens-fx')
      )
    : [];
  const nextStack = {
    ...generatedStack,
    modules: [
      ...preservedModules,
      ...generatedStack.modules.filter((module) =>
        owners.some((owner) => adjustmentModuleBelongsToOwner(module.type, owner))
      )
    ]
  };
  const nextDocumentAdjustments = createDefaultAdjustments();
  return {
    editorAdjustments,
    documentAdjustments: nextDocumentAdjustments,
    document: target.type === 'adjustment'
      ? setAdjustmentLayerStack(document, targetLayerId, nextStack)
      : setRasterLayerAdjustmentStack(document, targetLayerId, nextStack),
    scope
  };
};
