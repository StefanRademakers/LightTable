import type {
  GroupLayer,
  ImageDocument,
  LayerId,
  LayerNode,
  RasterLayer
} from './documentTypes';

export type LayerPath = readonly number[];

export interface LayerTreeEntry {
  node: LayerNode;
  path: LayerPath;
  parentId: LayerId | null;
}

/** Depth-first visual order; siblings remain bottom-most first. */
export const walkLayerTree = (
  nodes: readonly LayerNode[],
  parentId: LayerId | null = null,
  prefix: LayerPath = []
): LayerTreeEntry[] => nodes.flatMap((node, index) => {
  const path = [...prefix, index];
  const entry = { node, path, parentId };
  return node.type === 'group'
    ? [entry, ...walkLayerTree(node.children, node.id, path)]
    : [entry];
});

export const findLayerNode = (
  nodes: readonly LayerNode[],
  layerId: LayerId
) => walkLayerTree(nodes).find(({ node }) => node.id === layerId) ?? null;

export const findDocumentLayer = (
  document: ImageDocument,
  layerId: LayerId | null
) => layerId ? findLayerNode(document.layers, layerId)?.node ?? null : null;

export const findRasterLayer = (
  document: ImageDocument,
  layerId: LayerId | null
): RasterLayer | null => {
  const layer = findDocumentLayer(document, layerId);
  return layer?.type === 'raster' ? layer : null;
};

export interface RasterLayerTreeEntry {
  layer: RasterLayer;
  ancestors: readonly GroupLayer[];
  parentId: LayerId | null;
  path: LayerPath;
}

export const walkRasterLayers = (
  nodes: readonly LayerNode[],
  ancestors: readonly GroupLayer[] = [],
  parentId: LayerId | null = null,
  prefix: LayerPath = []
): RasterLayerTreeEntry[] => nodes.flatMap((node, index) => {
  const path = [...prefix, index];
  if (node.type === 'raster') return [{
    layer: node,
    ancestors,
    parentId,
    path
  }];
  if (node.type !== 'group') return [];
  return walkRasterLayers(node.children, [...ancestors, node], node.id, path);
});

/**
 * Raster projection consumed by the current compositor. Hidden ancestors hide
 * their descendants. Group blend/opacity isolation is deliberately not
 * approximated here; that arrives with the recursive group compositor.
 */
export const rasterLayersForComposite = (
  document: ImageDocument
): RasterLayer[] => walkRasterLayers(document.layers).map(({ layer, ancestors }) => {
  const visible = layer.visible && ancestors.every((group) => group.visible);
  return visible === layer.visible ? layer : { ...layer, visible };
});

export const rasterLayerCount = (document: ImageDocument) =>
  walkRasterLayers(document.layers).length;

export const siblingLayers = (
  document: ImageDocument,
  layerId: LayerId
): readonly LayerNode[] => {
  const entry = findLayerNode(document.layers, layerId);
  if (!entry) return [];
  if (entry.parentId === null) return document.layers;
  const parent = findLayerNode(document.layers, entry.parentId)?.node;
  return parent?.type === 'group' ? parent.children : [];
};

export const updateLayerNode = (
  nodes: readonly LayerNode[],
  layerId: LayerId,
  change: (node: LayerNode) => LayerNode
): LayerNode[] => nodes.map((node) => {
  if (node.id === layerId) return change(node);
  if (node.type !== 'group') return node;
  const children = updateLayerNode(node.children, layerId, change);
  return children.some((child, index) => child !== node.children[index])
    ? { ...node, children, revision: node.revision + 1, modifiedAt: Date.now() }
    : node;
});

export const insertLayerNode = (
  nodes: readonly LayerNode[],
  node: LayerNode,
  parentId: LayerId | null,
  index?: number
): LayerNode[] => {
  if (parentId === null) {
    const insertionIndex = Math.min(nodes.length, Math.max(0, index ?? nodes.length));
    const result = [...nodes];
    result.splice(insertionIndex, 0, node);
    return result;
  }
  return updateLayerNode(nodes, parentId, (parent) => {
    if (parent.type !== 'group') return parent;
    const insertionIndex = Math.min(
      parent.children.length,
      Math.max(0, index ?? parent.children.length)
    );
    const children = [...parent.children];
    children.splice(insertionIndex, 0, node);
    return { ...parent, children };
  });
};

export interface RemoveLayerNodeResult {
  nodes: LayerNode[];
  removed: LayerNode | null;
}

export const removeLayerNode = (
  nodes: readonly LayerNode[],
  layerId: LayerId
): RemoveLayerNodeResult => {
  const directIndex = nodes.findIndex((node) => node.id === layerId);
  if (directIndex >= 0) {
    const result = [...nodes];
    const [removed] = result.splice(directIndex, 1);
    return { nodes: result, removed };
  }
  for (let index = 0; index < nodes.length; index += 1) {
    const parent = nodes[index];
    if (parent.type !== 'group') continue;
    const nested = removeLayerNode(parent.children, layerId);
    if (!nested.removed) continue;
    const result = [...nodes];
    result[index] = {
      ...parent,
      children: nested.nodes,
      revision: parent.revision + 1,
      modifiedAt: Date.now()
    };
    return { nodes: result, removed: nested.removed };
  }
  return { nodes: [...nodes], removed: null };
};

/**
 * Moves an existing node into a root/group child list.
 *
 * `index` addresses the destination after the node has been removed. Invalid
 * parents and attempts to move a group into itself or one of its descendants
 * are rejected by returning the original tree.
 */
export const moveLayerNode = (
  nodes: readonly LayerNode[],
  layerId: LayerId,
  parentId: LayerId | null,
  index?: number
): LayerNode[] => {
  const source = findLayerNode(nodes, layerId);
  if (!source) return nodes as LayerNode[];
  if (parentId === layerId) return nodes as LayerNode[];

  if (parentId !== null) {
    const destination = findLayerNode(nodes, parentId);
    if (!destination || destination.node.type !== 'group') return nodes as LayerNode[];
    if (
      source.node.type === 'group'
      && findLayerNode(source.node.children, parentId)
    ) return nodes as LayerNode[];
  }

  const sourceIndex = source.path[source.path.length - 1];
  if (source.parentId === parentId && (index ?? sourceIndex) === sourceIndex) {
    return nodes as LayerNode[];
  }

  const removed = removeLayerNode(nodes, layerId);
  if (!removed.removed) return nodes as LayerNode[];
  return insertLayerNode(removed.nodes, removed.removed, parentId, index);
};
