import {
  adjustmentStackForScope,
  createAdjustmentStackFromBasicAdjustments
} from '../../processing/adjustmentStack';
import type { BasicAdjustments } from '../../types';
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
 * Projects editor controls onto an explicit local raster grade or one
 * Adjustment Layer without hidden document-wide creative state.
 *
 * Lens Fx remain document-output settings while editing an Adjustment Layer;
 * the layer receives only its typed adjustment stack. A stale/missing target
 * is rejected explicitly because silently applying it as a document grade
 * would change both render order and persisted meaning.
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
  const nextDocumentAdjustments: BasicAdjustments = {
    ...documentAdjustments,
    effects: structuredClone(editorAdjustments.effects)
  };
  const nextStack = adjustmentStackForScope(
    createAdjustmentStackFromBasicAdjustments(
      editorAdjustments,
      target.adjustmentStack ?? undefined
    ),
    // The current panel is a grade editor. Lens Fx keep their document-output
    // owner until their own explicit layer/local-stack renderer is introduced.
    // Filtering through adjustment-layer stores creative modules only, even
    // when the owner itself is a raster layer.
    'adjustment-layer'
  );
  return {
    editorAdjustments,
    documentAdjustments: nextDocumentAdjustments,
    document: target.type === 'adjustment'
      ? setAdjustmentLayerStack(document, targetLayerId, nextStack)
      : setRasterLayerAdjustmentStack(document, targetLayerId, nextStack),
    scope: target.type === 'adjustment' ? 'adjustment-layer' : 'layer'
  };
};
