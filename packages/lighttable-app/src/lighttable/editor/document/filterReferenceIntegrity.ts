import type { LayerNode } from './documentTypes';
import { walkLayerTree } from './layerTree';
import type { AdjustmentStack } from '../../processing/adjustmentStack';
import { filterKindForStack, filterSettings, setFilterSettings } from '../../processing/filter';

const clearRemovedMap = (
  stack: AdjustmentStack,
  removedRasterIds: ReadonlySet<string>
) => {
  if (filterKindForStack(stack) !== 'displace') return stack;
  const settings = filterSettings(stack, 'displace');
  return settings?.mapAssetId && removedRasterIds.has(settings.mapAssetId)
    ? setFilterSettings(stack, 'displace', { mapAssetId: null })
    : stack;
};

/** Clears Displace map references atomically when their raster owner is removed. */
export const reconcileRemovedFilterReferences = (
  previous: readonly LayerNode[],
  next: readonly LayerNode[]
): LayerNode[] => {
  const remainingRasterIds = new Set(walkLayerTree(next)
    .filter(({ node }) => node.type === 'raster')
    .map(({ node }) => node.id));
  const removedRasterIds = new Set(walkLayerTree(previous)
    .filter(({ node }) => node.type === 'raster' && !remainingRasterIds.has(node.id))
    .map(({ node }) => node.id));
  if (!removedRasterIds.size) return next as LayerNode[];
  const reconcile = (node: LayerNode): LayerNode => {
    if (node.type === 'group') {
      const children = node.children.map(reconcile);
      return children.some((child, index) => child !== node.children[index])
        ? { ...node, children, revision: node.revision + 1, modifiedAt: Date.now() }
        : node;
    }
    if (node.type === 'adjustment') {
      const adjustmentStack = clearRemovedMap(node.adjustmentStack, removedRasterIds);
      return adjustmentStack === node.adjustmentStack ? node : {
        ...node, adjustmentStack, revision: node.revision + 1, modifiedAt: Date.now()
      };
    }
    if (node.type !== 'raster' || !node.attachedAdjustments?.length) return node;
    let changed = false;
    const attachedAdjustments = node.attachedAdjustments.map((adjustment) => {
      const adjustmentStack = clearRemovedMap(adjustment.adjustmentStack, removedRasterIds);
      if (adjustmentStack === adjustment.adjustmentStack) return adjustment;
      changed = true;
      return { ...adjustment, adjustmentStack, revision: adjustment.revision + 1 };
    });
    return changed ? {
      ...node, attachedAdjustments, revision: node.revision + 1, modifiedAt: Date.now()
    } : node;
  };
  return next.map(reconcile);
};
