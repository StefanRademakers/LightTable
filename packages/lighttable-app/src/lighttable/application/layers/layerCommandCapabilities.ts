import {
  type ImageDocument,
  type LayerId,
  type LayerNode
} from '../../editor/document/documentTypes';
import {
  findDocumentLayer,
  findLayerNode,
  rasterLayerCount,
  siblingLayers,
  walkLayerTree
} from '../../editor/document/layerTree';
import {
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
    canMergeDown: activeIndex > 0
      && activeSiblings[activeIndex]?.type !== 'group'
      && activeSiblings[activeIndex - 1]?.type === 'raster',
    canMergeSelected: Boolean(getMergeLayersPlan(document, selectedLayerIds)),
    canFlattenActiveGroup: activeLayer?.type === 'group'
      && Boolean(getFlattenGroupPlan(document, activeLayer.id)),
    canFlattenImage: Boolean(getFlattenImagePlan(document))
  };
};
