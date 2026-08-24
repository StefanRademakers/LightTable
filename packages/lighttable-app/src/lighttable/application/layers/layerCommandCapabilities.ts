import {
  type ImageDocument,
  type LayerId,
  type LayerNode,
  layerSupportsLayerStyles,
  layerSupportsPixelEditing,
  layerSupportsRasterMask
} from '../../editor/document/documentTypes';
import {
  findDocumentLayer,
  findLayerNode,
  rasterLayerCount,
  siblingLayers,
  walkLayerTree
} from '../../editor/document/layerTree';
import {
  canDeleteLayers,
  getFlattenGroupPlan,
  getFlattenImagePlan,
  getMergeLayersPlan
} from '../../editor/document/documentCommands';

export interface LayerCommandCapabilities {
  readonly activeLayer: LayerNode | null;
  readonly activeSiblings: readonly LayerNode[];
  readonly activeIndex: number;
  readonly layerCount: number;
  readonly rasterLayerCount: number;
  readonly selectedLayerIds: readonly LayerId[];
  readonly canGroupSelection: boolean;
  readonly canUngroupSelection: boolean;
  readonly canToggleActiveClipping: boolean;
  readonly canMergeDown: boolean;
  readonly canMergeSelected: boolean;
  readonly canFlattenActiveGroup: boolean;
  readonly canFlattenImage: boolean;
  readonly canDuplicateActiveLayer: boolean;
  readonly canRasterizeActiveLayer: boolean;
  readonly hasRasterizableLayer: boolean;
  readonly hasMergeCandidate: boolean;
  readonly hasFlattenableGroup: boolean;
  readonly canDeleteSelection: boolean;
  readonly canEditActivePixels: boolean;
  readonly canEditActiveLayerStyles: boolean;
  readonly canAddActiveMask: boolean;
}

/**
 * Projects structural layer command availability from canonical document
 * state. Menus, panels and future keyboard/palette surfaces must consume this
 * query instead of independently reconstructing document invariants.
 */
export const queryLayerCommandCapabilities = (
  document: ImageDocument,
  requestedLayerIds: readonly LayerId[] = document.activeLayerId
    ? [document.activeLayerId]
    : []
): LayerCommandCapabilities => {
  const entries = walkLayerTree(document.layers);
  const existingLayerIds = new Set(entries.map(({ node }) => node.id));
  const selectedLayerIds = [...new Set(requestedLayerIds)]
    .filter((layerId) => existingLayerIds.has(layerId));
  const selectedEntries = selectedLayerIds
    .map((layerId) => findLayerNode(document.layers, layerId))
    .filter((entry) => entry !== null);
  const activeLayer = findDocumentLayer(document, document.activeLayerId);
  const activeSiblings = activeLayer
    ? siblingLayers(document, activeLayer.id)
    : [];
  const activeIndex = activeLayer
    ? activeSiblings.findIndex((layer) => layer.id === activeLayer.id)
    : -1;
  const siblingsByParent = new Map<LayerId | null, number>();
  for (const entry of entries) {
    siblingsByParent.set(entry.parentId, (siblingsByParent.get(entry.parentId) ?? 0) + 1);
  }
  const hasMergeCandidate = [...siblingsByParent.values()].some((count) => count > 1);
  const hasFlattenableGroup = entries.some(({ node }) => (
    node.type === 'group' && Boolean(getFlattenGroupPlan(document, node.id))
  ));

  return {
    activeLayer,
    activeSiblings,
    activeIndex,
    layerCount: entries.length,
    rasterLayerCount: rasterLayerCount(document),
    selectedLayerIds,
    canGroupSelection: selectedEntries.length > 0
      && selectedEntries.every((entry) => entry.parentId === selectedEntries[0]!.parentId),
    canUngroupSelection: selectedEntries.some((entry) => entry.node.type === 'group'),
    canToggleActiveClipping: Boolean(activeLayer?.clipping || activeIndex > 0),
    canMergeDown: activeIndex > 0,
    canMergeSelected: Boolean(getMergeLayersPlan(document, selectedLayerIds)),
    canFlattenActiveGroup: activeLayer?.type === 'group'
      && Boolean(getFlattenGroupPlan(document, activeLayer.id)),
    canFlattenImage: Boolean(getFlattenImagePlan(document)),
    canDuplicateActiveLayer: Boolean(activeLayer),
    canRasterizeActiveLayer: Boolean(
      activeLayer && !activeLayer.locks.all && !activeLayer.locks.pixels
    ),
    hasRasterizableLayer: entries.some(({ node }) => !node.locks.all && !node.locks.pixels),
    hasMergeCandidate,
    hasFlattenableGroup,
    canDeleteSelection: canDeleteLayers(document, selectedLayerIds),
    canEditActivePixels: Boolean(activeLayer && layerSupportsPixelEditing(activeLayer)),
    canEditActiveLayerStyles: Boolean(activeLayer && layerSupportsLayerStyles(activeLayer)),
    canAddActiveMask: Boolean(activeLayer && layerSupportsRasterMask(activeLayer) && !activeLayer.mask)
  };
};
