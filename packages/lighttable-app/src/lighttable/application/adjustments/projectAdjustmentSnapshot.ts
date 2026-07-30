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
  readonly scope: 'document' | 'adjustment-layer';
}

/**
 * Projects editor controls onto either the document output grade or one
 * Adjustment Layer without mixing those two scopes.
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
    return {
      editorAdjustments,
      documentAdjustments: editorAdjustments,
      document,
      scope: 'document'
    };
  }
  if (!document) {
    throw new Error('An Adjustment Layer grade requires an active document.');
  }
  const target = findDocumentLayer(document, targetLayerId);
  if (target?.type !== 'adjustment') {
    throw new Error('The Adjustment Layer target no longer exists.');
  }
  const nextDocumentAdjustments: BasicAdjustments = {
    ...documentAdjustments,
    effects: structuredClone(editorAdjustments.effects)
  };
  return {
    editorAdjustments,
    documentAdjustments: nextDocumentAdjustments,
    document: setAdjustmentLayerStack(
      document,
      targetLayerId,
      adjustmentStackForScope(
        createAdjustmentStackFromBasicAdjustments(
          editorAdjustments,
          target.adjustmentStack
        ),
        'adjustment-layer'
      )
    ),
    scope: 'adjustment-layer'
  };
};
