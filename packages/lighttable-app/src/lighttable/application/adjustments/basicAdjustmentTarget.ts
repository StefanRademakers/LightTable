import {
  layerIsLocked,
  type ImageDocument,
  type LayerId
} from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import {
  adjustmentPropertiesViewForStack
} from '../../processing/adjustmentLayerCatalog';
import { materializeBasicAdjustments } from '../../processing/adjustmentStack';
import { cloneAdjustments, createDefaultAdjustments, type BasicAdjustments } from '../../types';
import type { BasicAdjustmentTarget } from '../commands/semanticBasicAdjustmentCommandContract';

export interface ResolvedBasicAdjustmentTarget {
  readonly targetLayerId: LayerId | null;
  readonly adjustments: BasicAdjustments;
}

export const resolveBasicAdjustmentTarget = (
  document: ImageDocument,
  documentAdjustments: BasicAdjustments,
  target: BasicAdjustmentTarget
): ResolvedBasicAdjustmentTarget | { readonly message: string } => {
  if (target.kind === 'document') {
    return { targetLayerId: null, adjustments: cloneAdjustments(documentAdjustments) };
  }
  const layer = findDocumentLayer(document, target.layerId);
  if (!layer || (layer.type !== 'raster' && layer.type !== 'adjustment')) {
    return { message: 'The target layer cannot own a basic Grade.' };
  }
  if (layerIsLocked(layer, 'pixels')) {
    return { message: 'The target layer is locked against Grade edits.' };
  }
  if (layer.type === 'adjustment'
    && (layer.adjustmentKind ?? adjustmentPropertiesViewForStack(layer.adjustmentStack)) !== 'grade') {
    return { message: 'The target is a specialized Adjustment Layer, not a Grade Layer.' };
  }
  return {
    targetLayerId: layer.id,
    adjustments: layer.adjustmentStack
      ? materializeBasicAdjustments(
          layer.adjustmentStack,
          undefined,
          layer.type === 'adjustment' ? 'adjustment-layer' : 'layer'
        )
      : createDefaultAdjustments()
  };
};
