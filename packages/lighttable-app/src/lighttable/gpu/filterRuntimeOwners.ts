import { filterDefinitionForModule } from '@lighttable/filter-core';
import type { ImageDocument, LayerNode } from '../editor/document/documentTypes';
import { attachedAdjustmentOwnerId } from '../processing/attachedAdjustment';
import type { AdjustmentStack } from '../processing/adjustmentStack';
import { filterModule } from '../processing/filter';

/** Exact GPU runtime keys retained by the current canonical/preview document. */
export const collectActiveFilterRuntimeKeys = (document: ImageDocument): ReadonlySet<string> => {
  const activeKeys = new Set<string>();
  const collect = (ownerId: string, stack: AdjustmentStack | null) => {
    const module = filterModule(stack);
    if (module && filterDefinitionForModule(module.type)) {
      activeKeys.add(`${ownerId}::${module.id}`);
    }
  };
  const visit = (layer: LayerNode) => {
    if (layer.type === 'group') {
      layer.children.forEach(visit);
      return;
    }
    if (layer.type === 'adjustment') collect(layer.id, layer.adjustmentStack);
    if (layer.type !== 'raster') return;
    collect(layer.id, layer.adjustmentStack);
    for (const adjustment of layer.attachedAdjustments ?? []) {
      collect(
        attachedAdjustmentOwnerId(layer.id, adjustment.id),
        adjustment.adjustmentStack
      );
    }
  };
  document.layers.forEach(visit);
  return activeKeys;
};
