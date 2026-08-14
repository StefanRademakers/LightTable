import {
  createDefaultLayerLocks,
  createAdjustmentLayer as createAdjustmentLayerNode,
  createGroupLayer as createGroupLayerNode,
  createTextLayerNode,
  createVectorLayer as createVectorLayerNode,
  createLayerId,
  layerIsLocked,
  type ImageDocument,
  type LayerId,
  type LayerLocks,
  type LayerNode,
  type RasterMask,
  type RasterLayer,
  type Rect,
  type TextLayer,
  type VectorLayer
} from './documentTypes';
import {
  cloneTextLayerData,
  type TextLayerData
} from '@lighttable/text-core';
import {
  cloneVectorElement,
  convertLiveShapeToPath,
  createVectorLiveShape,
  parseVectorElement,
  type VectorElement,
  type VectorLiveShape,
  type VectorPath
} from '@lighttable/vector-core';
import { createDefaultGradientPaint, type GradientPaintInstance } from '@lighttable/paint-core';
import {
  setAdjustmentStackOwnerEnabled,
  type AdjustmentStackOwner,
  type AdjustmentStack
} from '../../processing/adjustmentStack';
import {
  findLayerNode,
  findRasterLayer,
  insertLayerNode,
  moveLayerNode,
  rasterLayerCount,
  removeLayerNode,
  siblingLayers,
  updateLayerNode,
  walkLayerTree
} from './layerTree';
import type { BlendMode } from './blendModes';
import type { AffineMatrix } from '../rendering/renderContract';
import { identityAffineMatrix, isFiniteAffineMatrix } from '../rendering/renderContract';
import { invertMatrix, multiplyMatrices } from '../geometry/affine';
import type { TranslationAlignmentResult } from '../autoAlign/alignmentTypes';
import { alignedTargetTransform } from '../autoAlign/alignmentMath';
import {
  createDefaultLayerStyleStack,
  duplicateLayerStyleStack
} from '../styles/layerStyleDefaults';
import {
  buildSceneTransformIndex,
  localTransformForReparent
} from './sceneTransformGraph';

const updateDocument = (document: ImageDocument, layers: LayerNode[], activeLayerId = document.activeLayerId): ImageDocument => ({
  ...document,
  layers,
  activeLayerId,
  revision: document.revision + 1,
  modifiedAt: Date.now()
});

const affineMatrixEquals = (left: AffineMatrix, right: AffineMatrix) => (
  left.a === right.a && left.b === right.b && left.c === right.c
  && left.d === right.d && left.tx === right.tx && left.ty === right.ty
);

const moveLayerNodePreservingWorld = (
  nodes: readonly LayerNode[],
  layerId: LayerId,
  parentId: LayerId | null,
  index?: number
): LayerNode[] => {
  const transforms = buildSceneTransformIndex({ layers: nodes as LayerNode[] });
  const source = transforms.get(layerId);
  if (source?.parentId === parentId) return moveLayerNode(nodes, layerId, parentId, index);
  const parentToDocument = parentId
    ? transforms.get(parentId)?.localToDocument ?? null
    : identityAffineMatrix();
  if (!source || !parentToDocument) return nodes as LayerNode[];
  const local = localTransformForReparent(source.localToDocument, parentToDocument);
  if (!local) return nodes as LayerNode[];
  const moved = moveLayerNode(nodes, layerId, parentId, index);
  if (moved === nodes) return nodes as LayerNode[];
  return affineMatrixEquals(source.localToParent, local)
    ? moved
    : updateLayerNode(moved, layerId, (node) => ({
        ...node,
        transform: local,
        geometryRevision: node.geometryRevision + 1,
        revision: node.revision + 1,
        modifiedAt: Date.now()
      }));
};

const normalizedSelectionEntries = (
  document: ImageDocument,
  layerIds: readonly LayerId[]
) => {
  const selected = new Set(layerIds);
  const entries = walkLayerTree(document.layers);
  const entryByPath = new Map(entries.map((entry) => [entry.path.join('/'), entry]));
  return entries.filter((entry) => {
    if (!selected.has(entry.node.id)) return false;
    // Selecting a group already selects its complete subtree for structural
    // commands. Ignore explicitly selected descendants to avoid double moves.
    return !entry.path.slice(0, -1).some((_, depth) => {
      const ancestorPath = entry.path.slice(0, depth + 1);
      const ancestor = entryByPath.get(ancestorPath.join('/'));
      return Boolean(ancestor && selected.has(ancestor.node.id));
    });
  });
};

export const createRasterLayer = (
  document: ImageDocument,
  name = 'Paint Layer',
  aboveLayerId = document.activeLayerId ?? undefined
): ImageDocument => {
  const now = Date.now();
  const id = createLayerId();
  const layer: RasterLayer = {
    id,
    type: 'raster',
    name,
    visible: true,
    locks: createDefaultLayerLocks(),
    opacity: 1,
    fillOpacity: 1,
    blendMode: 'normal',
    clipping: false,
    styleStack: createDefaultLayerStyleStack(),
    revision: 0,
    pixelRevision: 0,
    geometryRevision: 0,
    createdAt: now,
    modifiedAt: now,
    width: document.width,
    height: document.height,
    offsetX: 0,
    offsetY: 0,
    transform: identityAffineMatrix(),
    pixelSource: { kind: 'runtime-raster', runtimeId: id },
    adjustmentStack: null,
    dirtyBounds: null,
    mask: null
  };
  const anchor = aboveLayerId ? findLayerNode(document.layers, aboveLayerId) : null;
  const parentId = anchor?.parentId ?? null;
  const insertionIndex = anchor
    ? anchor.path[anchor.path.length - 1] + 1
    : document.layers.length;
  const layers = insertLayerNode(document.layers, layer, parentId, insertionIndex);
  return updateDocument(document, layers, id);
};

export const deleteLayer = (document: ImageDocument, layerId: LayerId): ImageDocument => {
  const entry = findLayerNode(document.layers, layerId);
  if (!entry || !canDeleteLayers(document, [layerId])) return document;

  const visualOrder = walkLayerTree(document.layers);
  const visualIndex = visualOrder.findIndex(({ node }) => node.id === layerId);
  const removed = removeLayerNode(document.layers, layerId);
  if (!removed.removed) return document;
  const remaining = walkLayerTree(removed.nodes);
  const activeLayerId = document.activeLayerId === layerId
    || (entry.node.type === 'group' && Boolean(findLayerNode(entry.node.children, document.activeLayerId!)))
    ? remaining[Math.min(visualIndex, remaining.length - 1)]?.node.id ?? null
    : document.activeLayerId;
  return updateDocument(document, removed.nodes, activeLayerId);
};

/** Mirrors the canonical delete invariant without allocating a document snapshot. */
export const canDeleteLayers = (
  document: ImageDocument,
  layerIds: readonly LayerId[]
) => {
  const entries = normalizedSelectionEntries(document, layerIds);
  if (!entries.length) return false;
  const removedRasterCount = entries.reduce((count, entry) => count + (
    entry.node.type === 'raster'
      ? 1
      : entry.node.type === 'group'
        ? walkLayerTree(entry.node.children).filter(({ node }) => node.type === 'raster').length
        : 0
  ), 0);
  const rasterCount = rasterLayerCount(document);
  if (rasterCount > 0) return rasterCount - removedRasterCount >= 1;
  const removedNodeCount = entries.reduce(
    (count, entry) => count + 1 + (
      entry.node.type === 'group' ? walkLayerTree(entry.node.children).length : 0
    ),
    0
  );
  return walkLayerTree(document.layers).length - removedNodeCount >= 1;
};

export const deleteLayers = (
  document: ImageDocument,
  layerIds: readonly LayerId[]
): ImageDocument => {
  const entries = normalizedSelectionEntries(document, layerIds);
  if (!entries.length || !canDeleteLayers(document, layerIds)) return document;

  const selected = new Set(entries.map(({ node }) => node.id));
  let layers = document.layers;
  entries
    .slice()
    .sort((left, right) => right.path.length - left.path.length)
    .forEach(({ node }) => {
      layers = removeLayerNode(layers, node.id).nodes;
    });
  const remaining = walkLayerTree(layers);
  const activeRemoved = document.activeLayerId
    ? entries.some(({ node }) =>
      node.id === document.activeLayerId
      || (node.type === 'group' && Boolean(findLayerNode(node.children, document.activeLayerId!)))
    )
    : false;
  const firstSelectedVisualIndex = walkLayerTree(document.layers)
    .findIndex(({ node }) => selected.has(node.id));
  const activeLayerId = activeRemoved
    ? remaining[Math.min(Math.max(0, firstSelectedVisualIndex), remaining.length - 1)]?.node.id ?? null
    : document.activeLayerId;
  return updateDocument(document, layers, activeLayerId);
};

const updateLayer = (
  document: ImageDocument,
  layerId: LayerId,
  change: (layer: LayerNode) => LayerNode
): ImageDocument => {
  const layers = updateLayerNode(document.layers, layerId, change);
  return layers.some((layer, index) => layer !== document.layers[index])
    ? updateDocument(document, layers)
    : document;
};

export const createGroupLayer = (
  document: ImageDocument,
  name = 'Group',
  aboveLayerId = document.activeLayerId ?? undefined
): ImageDocument => {
  const group = createGroupLayerNode(name);
  const anchor = aboveLayerId ? findLayerNode(document.layers, aboveLayerId) : null;
  const parentId = anchor?.parentId ?? null;
  const insertionIndex = anchor
    ? anchor.path[anchor.path.length - 1] + 1
    : document.layers.length;
  return updateDocument(
    document,
    insertLayerNode(document.layers, group, parentId, insertionIndex),
    group.id
  );
};

export const createAdjustmentLayer = (
  document: ImageDocument,
  adjustmentStack: AdjustmentStack,
  name = 'Grade',
  aboveLayerId = document.activeLayerId ?? undefined
): ImageDocument => {
  const layer = createAdjustmentLayerNode(adjustmentStack, name);
  const anchor = aboveLayerId ? findLayerNode(document.layers, aboveLayerId) : null;
  const parentId = anchor?.parentId ?? null;
  const insertionIndex = anchor
    ? anchor.path[anchor.path.length - 1] + 1
    : document.layers.length;
  return updateDocument(
    document,
    insertLayerNode(document.layers, layer, parentId, insertionIndex),
    layer.id
  );
};

const validatedVectorElements = (elements: readonly VectorElement[]) => {
  const ids = new Set<string>();
  return elements.map((element, index) => {
    const parsed = parseVectorElement(element, `Vector element ${index + 1}`);
    if (ids.has(parsed.id)) {
      throw new Error(`Duplicate vector element id ${parsed.id}.`);
    }
    ids.add(parsed.id);
    return cloneVectorElement(parsed);
  });
};

/** Inserts a native vector layer without allocating a raster backing store. */
export const createVectorLayer = (
  document: ImageDocument,
  elements: readonly VectorElement[] = [],
  name = 'Shape',
  aboveLayerId = document.activeLayerId ?? undefined,
  role: VectorLayer['role'] = 'artwork',
  presentation: Pick<VectorLayer, 'opacity' | 'blendMode'> = {
    opacity: 1,
    blendMode: 'normal'
  }
): ImageDocument => {
  const layer = createVectorLayerNode(validatedVectorElements(elements), name);
  layer.role = role;
  layer.opacity = presentation.opacity;
  layer.blendMode = presentation.blendMode;
  const anchor = aboveLayerId ? findLayerNode(document.layers, aboveLayerId) : null;
  const parentId = anchor?.parentId ?? null;
  const insertionIndex = anchor
    ? anchor.path[anchor.path.length - 1] + 1
    : document.layers.length;
  return updateDocument(
    document,
    insertLayerNode(document.layers, layer, parentId, insertionIndex),
    layer.id
  );
};

/** Inserts a semantic, resolution-independent Gradient Fill layer. */
export const createGradientFillLayer = (
  document: ImageDocument,
  paint: GradientPaintInstance = createDefaultGradientPaint(),
  name = 'Gradient Fill',
  aboveLayerId = document.activeLayerId ?? undefined
): ImageDocument => {
  const shape = createVectorLiveShape(`gradient-fill-shape-${crypto.randomUUID()}`, {
    kind: 'rectangle', width: document.width, height: document.height,
    cornerRadii: [0, 0, 0, 0], linkedCorners: true
  }, name);
  shape.style.fill = structuredClone(paint);
  shape.style.stroke = null;
  shape.styleRevision = 1;
  const layer = createVectorLayerNode([shape], name, 'gradient-fill');
  const anchor = aboveLayerId ? findLayerNode(document.layers, aboveLayerId) : null;
  const parentId = anchor?.parentId ?? null;
  const insertionIndex = anchor ? anchor.path.at(-1)! + 1 : document.layers.length;
  return updateDocument(document, insertLayerNode(document.layers, layer, parentId, insertionIndex), layer.id);
};

/**
 * Replaces one text node with canonical paths at the exact same tree address.
 * The application history layer retains the untouched opening document so an
 * undo restores the complete editable TextLayer rather than reconstructing it.
 */
export const replaceTextLayerWithVectorPaths = (
  document: ImageDocument,
  layerId: LayerId,
  paths: readonly VectorPath[]
): ImageDocument => {
  const layer = findLayerNode(document.layers, layerId)?.node;
  if (layer?.type !== 'text' || layerIsLocked(layer, 'pixels') || paths.length === 0) {
    return document;
  }
  const elements = validatedVectorElements(paths);
  const { text: _discardedTextAuthority, ...common } = layer;
  const replacement: VectorLayer = {
    ...common,
    type: 'vector',
    antiAlias: true,
    elements,
    revision: layer.revision + 1,
    geometryRevision: layer.geometryRevision + 1,
    modifiedAt: Date.now()
  };
  return updateDocument(
    document,
    updateLayerNode(document.layers, layerId, () => replacement)
  );
};

/** Inserts a canonical native text layer beside the active layer. */
export const createTextLayer = (
  document: ImageDocument,
  text: TextLayerData,
  name = 'Text',
  aboveLayerId: LayerId | null | undefined = document.activeLayerId ?? undefined
): ImageDocument => {
  const layer = createTextLayerNode(text, name);
  const anchor = aboveLayerId ? findLayerNode(document.layers, aboveLayerId) : null;
  const parentId = anchor?.parentId ?? null;
  const insertionIndex = anchor
    ? anchor.path[anchor.path.length - 1] + 1
    : document.layers.length;
  return updateDocument(
    document,
    insertLayerNode(document.layers, layer, parentId, insertionIndex),
    layer.id
  );
};

const updateVectorLayerElements = (
  document: ImageDocument,
  layerId: LayerId,
  change: (layer: VectorLayer) => readonly VectorElement[]
) => updateLayer(document, layerId, (layer) => {
  if (layer.type !== 'vector') return layer;
  const elements = validatedVectorElements(change(layer));
  return {
    ...layer,
    elements,
    revision: layer.revision + 1,
    modifiedAt: Date.now()
  };
});

export const replaceVectorLayerElements = (
  document: ImageDocument,
  layerId: LayerId,
  elements: readonly VectorElement[]
) => updateVectorLayerElements(document, layerId, () => elements);

export const appendVectorElement = (
  document: ImageDocument,
  layerId: LayerId,
  element: VectorElement
) => updateVectorLayerElements(document, layerId, (layer) => {
  if (layer.elements.some(({ id }) => id === element.id)) {
    throw new Error(`Vector element ${element.id} already exists in layer ${layer.name}.`);
  }
  return [...layer.elements, element];
});

export const replaceVectorElement = (
  document: ImageDocument,
  layerId: LayerId,
  element: VectorElement
) => updateVectorLayerElements(document, layerId, (layer) => {
  const index = layer.elements.findIndex(({ id }) => id === element.id);
  if (index < 0) throw new Error(`Unknown vector element ${element.id}.`);
  if (layer.elements[index].type !== element.type) {
    throw new Error(`Vector element ${element.id} cannot change type implicitly.`);
  }
  const elements = [...layer.elements];
  elements[index] = element;
  return elements;
});

export const appendVectorPath = (
  document: ImageDocument,
  layerId: LayerId,
  path: VectorPath
) => appendVectorElement(document, layerId, path);

export const replaceVectorPath = (
  document: ImageDocument,
  layerId: LayerId,
  path: VectorPath
) => {
  const layer = findLayerNode(document.layers, layerId)?.node;
  const current = layer?.type === 'vector'
    ? layer.elements.find(({ id }) => id === path.id)
    : null;
  if (current?.type === 'live-shape') {
    throw new Error(`Vector element ${path.id} is a live shape; convert it to a path before path editing.`);
  }
  return replaceVectorElement(document, layerId, path);
};

export const replaceVectorLiveShape = (
  document: ImageDocument,
  layerId: LayerId,
  shape: VectorLiveShape
) => replaceVectorElement(document, layerId, shape);

/** Explicitly discards live parameters and makes their realized anchors authoritative. */
export const convertVectorLiveShapeToPath = (
  document: ImageDocument,
  layerId: LayerId,
  elementId: string
) => updateVectorLayerElements(document, layerId, (layer) => {
  const index = layer.elements.findIndex(({ id }) => id === elementId);
  if (index < 0) throw new Error(`Unknown vector element ${elementId}.`);
  const element = layer.elements[index];
  if (element.type !== 'live-shape') {
    throw new Error(`Vector element ${elementId} is already a path.`);
  }
  const elements = [...layer.elements];
  elements[index] = convertLiveShapeToPath(element);
  return elements;
});

export const deleteVectorElements = (
  document: ImageDocument,
  layerId: LayerId,
  elementIds: readonly string[]
) => {
  const selected = new Set(elementIds);
  if (!selected.size) return document;
  const layer = findLayerNode(document.layers, layerId)?.node;
  if (layer?.type !== 'vector' || !layer.elements.some(({ id }) => selected.has(id))) {
    return document;
  }
  return updateVectorLayerElements(
    document,
    layerId,
    (current) => current.elements.filter(({ id }) => !selected.has(id))
  );
};

export const deleteVectorPaths = (
  document: ImageDocument,
  layerId: LayerId,
  pathIds: readonly string[]
) => {
  const selected = new Set(pathIds);
  if (!selected.size) return document;
  const layer = findLayerNode(document.layers, layerId)?.node;
  if (layer?.type !== 'vector'
    || !layer.elements.some((element) => element.type === 'path' && selected.has(element.id))) {
    return document;
  }
  return updateVectorLayerElements(
    document,
    layerId,
    (current) => current.elements.filter((element) =>
      element.type !== 'path' || !selected.has(element.id))
  );
};

export const setAdjustmentLayerStack = (
  document: ImageDocument,
  layerId: LayerId,
  adjustmentStack: AdjustmentStack
) => updateLayer(document, layerId, (layer) => {
  if (layer.type !== 'adjustment') return layer;
  return {
    ...layer,
    adjustmentStack: structuredClone(adjustmentStack),
    revision: layer.revision + 1,
    modifiedAt: Date.now()
  };
});

export const setRasterLayerAdjustmentStack = (
  document: ImageDocument,
  layerId: LayerId,
  adjustmentStack: AdjustmentStack | null
) => updateLayer(document, layerId, (layer) => {
  if (layer.type !== 'raster') return layer;
  return {
    ...layer,
    adjustmentStack: adjustmentStack ? structuredClone(adjustmentStack) : null,
    revision: layer.revision + 1,
    modifiedAt: Date.now()
  };
});

export const setRasterLayerAdjustmentStackEnabled = (
  document: ImageDocument,
  layerId: LayerId,
  enabled: boolean,
  owner: AdjustmentStackOwner = 'grade'
) => updateLayer(document, layerId, (layer) => {
  if (layer.type !== 'raster' || !layer.adjustmentStack) return layer;
  const adjustmentStack = setAdjustmentStackOwnerEnabled(
    layer.adjustmentStack,
    owner,
    enabled
  );
  if (adjustmentStack === layer.adjustmentStack) return layer;
  return {
    ...layer,
    adjustmentStack,
    revision: layer.revision + 1,
    modifiedAt: Date.now()
  };
});

export const renameLayer = (document: ImageDocument, layerId: LayerId, name: string) =>
  updateLayer(document, layerId, (layer) => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === layer.name) return layer;
    return { ...layer, name: trimmed, revision: layer.revision + 1, modifiedAt: Date.now() };
  });

export const setLayerVisibility = (document: ImageDocument, layerId: LayerId, visible: boolean) =>
  updateLayer(document, layerId, (layer) => layer.visible === visible ? layer : ({
    ...layer, visible, revision: layer.revision + 1, modifiedAt: Date.now()
  }));

export const setLayersVisibility = (
  document: ImageDocument,
  layerIds: readonly LayerId[],
  visible: boolean
) => {
  // Visibility and lock changes are property edits, not structural edits.
  // Keep explicitly selected descendants so selecting a group plus one of its
  // children updates both rows instead of silently discarding the child.
  const selected = new Set(layerIds.filter((layerId) => findLayerNode(document.layers, layerId)));
  if (!selected.size) return document;
  const now = Date.now();
  const update = (nodes: readonly LayerNode[]): LayerNode[] => nodes.map((node) => {
    if (selected.has(node.id)) {
      return node.visible === visible ? node : {
        ...node, visible, revision: node.revision + 1, modifiedAt: now
      };
    }
    if (node.type !== 'group') return node;
    const children = update(node.children);
    return children.some((child, index) => child !== node.children[index])
      ? { ...node, children, revision: node.revision + 1, modifiedAt: now }
      : node;
  });
  const layers = update(document.layers);
  return layers.some((node, index) => node !== document.layers[index])
    ? updateDocument(document, layers)
    : document;
};

export const setLayerOpacity = (document: ImageDocument, layerId: LayerId, opacity: number) =>
  updateLayer(document, layerId, (layer) => {
    const next = Math.min(1, Math.max(0, opacity));
    return layer.opacity === next ? layer : { ...layer, opacity: next, revision: layer.revision + 1, modifiedAt: Date.now() };
  });

export const setLayerFillOpacity = (document: ImageDocument, layerId: LayerId, fillOpacity: number) =>
  updateLayer(document, layerId, (layer) => {
    const next = Math.min(1, Math.max(0, fillOpacity));
    return layer.fillOpacity === next ? layer : {
      ...layer,
      fillOpacity: next,
      revision: layer.revision + 1,
      modifiedAt: Date.now()
    };
  });

export const setVectorLayerAntiAlias = (
  document: ImageDocument,
  layerId: LayerId,
  antiAlias: boolean
) => updateLayer(document, layerId, (layer) => (
  layer.type !== 'vector' || layer.antiAlias === antiAlias
    ? layer
    : {
        ...layer,
        antiAlias,
        revision: layer.revision + 1,
        modifiedAt: Date.now()
      }
));

export const setLayerClipping = (document: ImageDocument, layerId: LayerId, clipping: boolean) =>
  updateLayer(document, layerId, (layer) => layer.clipping === clipping ? layer : ({
    ...layer,
    clipping,
    revision: layer.revision + 1,
    modifiedAt: Date.now()
  }));

export const setLayerBlendMode = (document: ImageDocument, layerId: LayerId, blendMode: BlendMode) =>
  updateLayer(document, layerId, (layer) => layer.blendMode === blendMode ? layer : ({
    ...layer, blendMode, revision: layer.revision + 1, modifiedAt: Date.now()
  }));

export const setLayerLocked = (document: ImageDocument, layerId: LayerId, locked: boolean) =>
  updateLayer(document, layerId, (layer) => layer.locks.all === locked ? layer : ({
    ...layer,
    locks: { ...layer.locks, all: locked },
    revision: layer.revision + 1,
    modifiedAt: Date.now()
  }));

export const setLayerLock = (
  document: ImageDocument,
  layerId: LayerId,
  lock: keyof LayerLocks,
  locked: boolean
) => updateLayer(document, layerId, (layer) => layer.locks[lock] === locked ? layer : ({
  ...layer,
  locks: { ...layer.locks, [lock]: locked },
  revision: layer.revision + 1,
  modifiedAt: Date.now()
}));

export const setLayersLock = (
  document: ImageDocument,
  layerIds: readonly LayerId[],
  lock: keyof LayerLocks,
  locked: boolean
) => {
  const selected = new Set(layerIds.filter((layerId) => findLayerNode(document.layers, layerId)));
  if (!selected.size) return document;
  const now = Date.now();
  const update = (nodes: readonly LayerNode[]): LayerNode[] => nodes.map((node) => {
    if (selected.has(node.id)) {
      return node.locks[lock] === locked ? node : {
        ...node,
        locks: { ...node.locks, [lock]: locked },
        revision: node.revision + 1,
        modifiedAt: now
      };
    }
    if (node.type !== 'group') return node;
    const children = update(node.children);
    return children.some((child, index) => child !== node.children[index])
      ? { ...node, children, revision: node.revision + 1, modifiedAt: now }
      : node;
  });
  const layers = update(document.layers);
  return layers.some((node, index) => node !== document.layers[index])
    ? updateDocument(document, layers)
    : document;
};

export const setLayerTransform = (document: ImageDocument, layerId: LayerId, transform: AffineMatrix) =>
  updateLayer(document, layerId, (layer) => {
    if (!isFiniteAffineMatrix(transform)) return layer;
    if (
      layer.transform.a === transform.a
      && layer.transform.b === transform.b
      && layer.transform.c === transform.c
      && layer.transform.d === transform.d
      && layer.transform.tx === transform.tx
      && layer.transform.ty === transform.ty
    ) return layer;
    const previousInverse = invertMatrix(layer.transform);
    const mask = layer.mask?.linked && previousInverse
      ? {
          ...layer.mask,
          transform: multiplyMatrices(
            multiplyMatrices(transform, previousInverse),
            layer.mask.transform
          ),
          revision: layer.mask.revision + 1
        }
      : layer.mask;
    return {
      ...layer,
      transform: { ...transform },
      mask,
      geometryRevision: layer.geometryRevision + 1,
      revision: layer.revision + 1,
      modifiedAt: Date.now()
    };
  });

/** Records a raster surface whose pixels now live directly in document space. */
export const setRasterLayerDocumentSurface = (
  document: ImageDocument,
  layerId: LayerId,
  width: number,
  height: number
) => updateLayer(document, layerId, (layer) => {
  if (layer.type !== 'raster' || width <= 0 || height <= 0) return layer;
  const transform = identityAffineMatrix();
  if (
    layer.width === width
    && layer.height === height
    && layer.offsetX === 0
    && layer.offsetY === 0
    && affineMatrixEquals(layer.transform, transform)
  ) return layer;
  return {
    ...layer,
    width,
    height,
    offsetX: 0,
    offsetY: 0,
    transform,
    geometryRevision: layer.geometryRevision + 1,
    revision: layer.revision + 1,
    modifiedAt: Date.now()
  };
});

export const applyTranslationAlignment = (
  document: ImageDocument,
  result: TranslationAlignmentResult
) => {
  if (result.referenceLayerId === result.targetLayerId) return document;
  if (!findRasterLayer(document, result.referenceLayerId)) return document;
  const target = findRasterLayer(document, result.targetLayerId);
  if (!target || layerIsLocked(target, 'position')) return document;
  return setLayerTransform(
    document,
    target.id,
    alignedTargetTransform(target.transform, result)
  );
};

export const addLayerMask = (document: ImageDocument, layerId: LayerId) =>
  updateLayer(document, layerId, (layer) => layer.mask ? layer : ({
    ...layer,
    mask: {
      id: `mask-${crypto.randomUUID()}`,
      enabled: true,
      linked: true,
      transform: identityAffineMatrix(),
      density: 1,
      feather: 0,
      revision: 0,
      pixelRevision: 0,
      dirtyBounds: null
    },
    revision: layer.revision + 1,
    modifiedAt: Date.now()
  }));

export const setLayerMaskLinked = (document: ImageDocument, layerId: LayerId, linked: boolean) =>
  updateLayer(document, layerId, (layer) => !layer.mask || layer.mask.linked === linked ? layer : ({
    ...layer,
    mask: { ...layer.mask, linked, revision: layer.mask.revision + 1 },
    revision: layer.revision + 1,
    modifiedAt: Date.now()
  }));

export const setLayerMaskTransform = (
  document: ImageDocument,
  layerId: LayerId,
  transform: AffineMatrix
) => updateLayer(document, layerId, (layer) => (
  !layer.mask || !isFiniteAffineMatrix(transform) || affineMatrixEquals(layer.mask.transform, transform)
    ? layer
    : {
        ...layer,
        mask: { ...layer.mask, transform: { ...transform }, revision: layer.mask.revision + 1 },
        revision: layer.revision + 1,
        modifiedAt: Date.now()
      }
));

export const removeLayerMask = (document: ImageDocument, layerId: LayerId) =>
  updateLayer(document, layerId, (layer) => !layer.mask ? layer : ({
    ...layer, mask: null, revision: layer.revision + 1, modifiedAt: Date.now()
  }));

export const setLayerMaskEnabled = (document: ImageDocument, layerId: LayerId, enabled: boolean) =>
  updateLayer(document, layerId, (layer) => !layer.mask || layer.mask.enabled === enabled ? layer : ({
    ...layer,
    mask: { ...layer.mask, enabled, revision: layer.mask.revision + 1 },
    revision: layer.revision + 1,
    modifiedAt: Date.now()
  }));

export const setLayerMaskProperties = (
  document: ImageDocument,
  layerId: LayerId,
  properties: Partial<Pick<RasterMask, 'density' | 'feather'>>
) => updateLayer(document, layerId, (layer) => {
  if (!layer.mask) return layer;
  const density = Math.max(0, Math.min(1, properties.density ?? layer.mask.density));
  const feather = Math.max(0, properties.feather ?? layer.mask.feather);
  if (density === layer.mask.density && feather === layer.mask.feather) return layer;
  return {
    ...layer,
    mask: {
      ...layer.mask,
      density,
      feather,
      revision: layer.mask.revision + 1
    },
    revision: layer.revision + 1,
    modifiedAt: Date.now()
  };
});

export const markLayerMaskPixelsChanged = (document: ImageDocument, layerId: LayerId, dirtyBounds: Rect) =>
  updateLayer(document, layerId, (layer) => !layer.mask ? layer : ({
    ...layer,
    mask: {
      ...layer.mask,
      revision: layer.mask.revision + 1,
      pixelRevision: layer.mask.pixelRevision + 1,
      dirtyBounds
    },
    revision: layer.revision + 1,
    modifiedAt: Date.now()
  }));

export const duplicateLayer = (document: ImageDocument, layerId: LayerId): ImageDocument => {
  const entry = findLayerNode(document.layers, layerId);
  if (!entry || (entry.node.type !== 'raster'
    && entry.node.type !== 'text'
    && entry.node.type !== 'vector')) return document;
  const now = Date.now();
  const source = entry.node;
  const id = createLayerId();
  const duplicate: RasterLayer | TextLayer | VectorLayer = source.type === 'raster'
    ? {
        ...source,
        id,
        name: `${source.name} copy`,
        createdAt: now,
        modifiedAt: now,
        revision: 0,
        pixelRevision: 0,
        geometryRevision: 0,
        pixelSource: { kind: 'runtime-raster', runtimeId: id },
        styleStack: duplicateLayerStyleStack(source.styleStack),
        mask: source.mask ? { ...source.mask, id: `mask-${crypto.randomUUID()}`, revision: 0, pixelRevision: 0 } : null
      }
    : source.type === 'text' ? {
        ...source,
        id,
        name: `${source.name} copy`,
        createdAt: now,
        modifiedAt: now,
        revision: 0,
        geometryRevision: 0,
        text: cloneTextLayerData(source.text),
        styleStack: duplicateLayerStyleStack(source.styleStack),
        mask: source.mask ? { ...source.mask, id: `mask-${crypto.randomUUID()}`, revision: 0, pixelRevision: 0 } : null
      } : {
        ...source,
        id,
        name: `${source.name} copy`,
        createdAt: now,
        modifiedAt: now,
        revision: 0,
        geometryRevision: 0,
        elements: source.elements.map((element) => {
          const cloned = cloneVectorElement(element);
          cloned.id = `vector-${crypto.randomUUID()}`;
          if (cloned.type === 'path') {
            cloned.subpaths.forEach((subpath) => {
              subpath.id = `subpath-${crypto.randomUUID()}`;
              subpath.anchors.forEach((anchor) => {
                anchor.id = `anchor-${crypto.randomUUID()}`;
              });
            });
          }
          return cloned;
        }),
        styleStack: duplicateLayerStyleStack(source.styleStack),
        mask: source.mask ? {
          ...source.mask, id: `mask-${crypto.randomUUID()}`, revision: 0, pixelRevision: 0
        } : null
      };
  const layers = insertLayerNode(
    document.layers,
    duplicate,
    entry.parentId,
    entry.path[entry.path.length - 1] + 1
  );
  return updateDocument(document, layers, id);
};

export const mergeLayerDown = (document: ImageDocument, layerId: LayerId): ImageDocument => {
  const entry = findLayerNode(document.layers, layerId);
  if (!entry) return document;
  const siblings = siblingLayers(document, layerId);
  const index = siblings.findIndex((layer) => layer.id === layerId);
  const top = siblings[index];
  const bottom = siblings[index - 1];
  if (index <= 0 || !top || !bottom) return document;
  return mergeLayers(document, [bottom.id, top.id]);
};

export interface MergeLayersPlan {
  /** Bottom-to-top compositing order. */
  layerIds: LayerId[];
  destinationId: LayerId;
  name: string;
}

export interface FlattenLayersPlan {
  /** Complete subtree rendered into destinationId. */
  layerIds: LayerId[];
  destinationId: LayerId;
  name: string;
  targetGroupId: LayerId | null;
}

const layerIdsIn = (nodes: readonly LayerNode[]) =>
  walkLayerTree(nodes).map((entry) => entry.node.id);

export const getFlattenGroupPlan = (
  document: ImageDocument,
  groupId: LayerId
): FlattenLayersPlan | null => {
  const entry = findLayerNode(document.layers, groupId);
  if (!entry || entry.node.type !== 'group') return null;
  const layerIds = layerIdsIn(entry.node.children);
  if (!layerIds.length) return null;
  return {
    layerIds,
    destinationId: entry.node.children[0]!.id,
    name: entry.node.name,
    targetGroupId: groupId
  };
};

export const getFlattenImagePlan = (document: ImageDocument): FlattenLayersPlan | null => {
  const layerIds = layerIdsIn(document.layers);
  if (!layerIds.length) return null;
  return {
    layerIds,
    destinationId: document.layers[0]!.id,
    name: document.name,
    targetGroupId: null
  };
};

const flattenedRaster = (
  document: ImageDocument,
  source: LayerNode,
  name: string
): RasterLayer => {
  const id = createLayerId();
  return {
    id,
    type: 'raster',
    name,
    visible: true,
    locks: { ...source.locks },
    opacity: 1,
    fillOpacity: 1,
    blendMode: 'normal',
    clipping: false,
    styleStack: createDefaultLayerStyleStack(),
    adjustmentStack: null,
    transform: identityAffineMatrix(),
    mask: null,
    createdAt: source.createdAt,
    width: document.width,
    height: document.height,
    offsetX: 0,
    offsetY: 0,
    pixelSource: { kind: 'runtime-raster', runtimeId: id },
    geometryRevision: source.geometryRevision + 1,
    pixelRevision: source.type === 'raster' ? source.pixelRevision + 1 : 1,
    revision: source.revision + 1,
    modifiedAt: Date.now(),
    dirtyBounds: { x: 0, y: 0, width: document.width, height: document.height }
  };
};

export const flattenGroup = (
  document: ImageDocument,
  groupId: LayerId
): ImageDocument => {
  const plan = getFlattenGroupPlan(document, groupId);
  const destination = plan ? findLayerNode(document.layers, plan.destinationId)?.node : null;
  const group = findLayerNode(document.layers, groupId)?.node;
  if (!plan || !destination || group?.type !== 'group') return document;
  const replacement = {
    ...flattenedRaster(document, destination, plan.name),
    // Flattening bakes the group's children, but the replacement still
    // occupies the group's place and must retain its outer visibility/locks.
    visible: group.visible,
    locks: { ...group.locks }
  };
  return updateDocument(
    document,
    updateLayerNode(document.layers, groupId, () => replacement),
    replacement.id
  );
};

export const flattenImage = (document: ImageDocument): ImageDocument => {
  const plan = getFlattenImagePlan(document);
  const destination = plan ? findLayerNode(document.layers, plan.destinationId)?.node : null;
  if (!plan || !destination) return document;
  const replacement = flattenedRaster(document, destination, plan.name);
  return updateDocument(document, [replacement], replacement.id);
};

/** Replaces live text with a full-canvas raster destination using the same stable layer ID. */
export const rasterizeTextLayer = (
  document: ImageDocument,
  layerId: LayerId
): ImageDocument => {
  const source = findLayerNode(document.layers, layerId)?.node ?? null;
  if (source?.type !== 'text' || layerIsLocked(source, 'pixels')) return document;
  const { text: _text, ...common } = source;
  const now = Date.now();
  const replacement: RasterLayer = {
    ...common,
    type: 'raster',
    transform: identityAffineMatrix(),
    geometryRevision: source.geometryRevision + 1,
    pixelRevision: 1,
    width: document.width,
    height: document.height,
    offsetX: 0,
    offsetY: 0,
    pixelSource: { kind: 'runtime-raster', runtimeId: source.id },
    adjustmentStack: null,
    dirtyBounds: { x: 0, y: 0, width: document.width, height: document.height },
    revision: source.revision + 1,
    modifiedAt: now
  };
  return updateDocument(
    document,
    updateLayerNode(document.layers, layerId, () => replacement),
    replacement.id
  );
};

/**
 * Returns a lossless merge plan for a Layers-panel selection.
 *
 * Selected layers must be contiguous siblings. Every semantic layer type is
 * composited through the same recursive renderer before replacement. The
 * destination is always a newly allocated full-canvas raster, so the
 * bottom-most selected layer does not itself need to be raster content.
 * Allowing gaps would
 * silently move unselected layers above or below the flattened result and
 * therefore change the document's appearance.
 */
export const getMergeLayersPlan = (
  document: ImageDocument,
  selectedLayerIds: readonly LayerId[]
): MergeLayersPlan | null => {
  const selected = new Set(selectedLayerIds);
  if (selected.size < 2) return null;
  const entries = [...selected].map((id) => findLayerNode(document.layers, id));
  if (entries.some((entry) => !entry)
    || entries.some((entry) => entry!.parentId !== entries[0]!.parentId)) return null;

  const siblings = siblingLayers(document, entries[0]!.node.id);
  const indexes = siblings
    .map((layer, index) => selected.has(layer.id) ? index : -1)
    .filter((index) => index >= 0);
  if (
    indexes.length !== selected.size
    || indexes[indexes.length - 1] - indexes[0] + 1 !== indexes.length
  ) return null;

  const layers = siblings.slice(indexes[0], indexes[indexes.length - 1] + 1);
  // The GPU compositor evaluates each selected layer's realized presentation
  // in document order and writes it to a fresh raster destination.
  if (!layers[0]) return null;
  return {
    layerIds: layers.map((layer) => layer.id),
    destinationId: layers[0].id,
    name: layers[layers.length - 1].name
  };
};

export const mergeLayers = (
  document: ImageDocument,
  selectedLayerIds: readonly LayerId[]
): ImageDocument => {
  const plan = getMergeLayersPlan(document, selectedLayerIds);
  if (!plan) return document;
  const destination = findLayerNode(document.layers, plan.destinationId)?.node;
  if (!destination) return document;
  const now = Date.now();
  const id = createLayerId();
  const merged: RasterLayer = {
    id,
    type: 'raster',
    name: plan.name,
    visible: plan.layerIds.some((layerId) => {
      const layer = findLayerNode(document.layers, layerId)?.node;
      return Boolean(layer?.visible && layer.opacity > 0);
    }),
    locks: { ...destination.locks },
    opacity: 1,
    fillOpacity: 1,
    blendMode: 'normal',
    clipping: false,
    styleStack: createDefaultLayerStyleStack(),
    transform: identityAffineMatrix(),
    adjustmentStack: null,
    createdAt: destination.createdAt,
    width: document.width,
    height: document.height,
    offsetX: 0,
    offsetY: 0,
    pixelSource: { kind: 'runtime-raster', runtimeId: id },
    mask: null,
    geometryRevision: destination.geometryRevision + 1,
    revision: destination.revision + 1,
    pixelRevision: destination.type === 'raster' ? destination.pixelRevision + 1 : 1,
    modifiedAt: now,
    dirtyBounds: { x: 0, y: 0, width: document.width, height: document.height }
  };
  let layers = document.layers;
  for (const layerId of plan.layerIds) {
    if (layerId === plan.destinationId) continue;
    layers = removeLayerNode(layers, layerId).nodes;
  }
  layers = updateLayerNode(layers, plan.destinationId, () => merged);
  return updateDocument(document, layers, merged.id);
};

export const moveLayer = (document: ImageDocument, layerId: LayerId, targetIndex: number): ImageDocument => {
  const entry = findLayerNode(document.layers, layerId);
  if (!entry) return document;
  const siblings = siblingLayers(document, layerId);
  const index = siblings.findIndex((layer) => layer.id === layerId);
  const clamped = Math.min(siblings.length - 1, Math.max(0, targetIndex));
  if (index < 0 || index === clamped) return document;
  // targetIndex is the final sibling index, so it can be used directly after
  // removal. Subtracting one here made upward moves stop one slot too early.
  const layers = moveLayerNode(document.layers, layerId, entry.parentId, clamped);
  return updateDocument(document, layers);
};

/**
 * Reorders a layer relative to another layer in compositing order.
 *
 * The document stores the bottom-most layer first, while the Layers panel
 * displays the reverse order. Keeping that conversion in the document command
 * prevents drag UI code from depending on the storage direction.
 */
export const moveLayerRelative = (
  document: ImageDocument,
  layerId: LayerId,
  targetLayerId: LayerId,
  placement: 'above' | 'below'
): ImageDocument => {
  if (layerId === targetLayerId) return document;
  const source = findLayerNode(document.layers, layerId);
  const target = findLayerNode(document.layers, targetLayerId);
  if (!source || !target) return document;
  const targetSiblings = siblingLayers(document, targetLayerId);
  const targetIndex = targetSiblings.findIndex((layer) => layer.id === targetLayerId);
  let insertionIndex = targetIndex + (placement === 'above' ? 1 : 0);
  if (source.parentId === target.parentId) {
    const sourceIndex = source.path[source.path.length - 1];
    if (sourceIndex < insertionIndex) insertionIndex -= 1;
  }
  const layers = moveLayerNodePreservingWorld(
    document.layers,
    layerId,
    target.parentId,
    insertionIndex
  );
  if (layers === document.layers) return document;
  return updateDocument(document, layers);
};

export const moveLayerIntoGroup = (
  document: ImageDocument,
  layerId: LayerId,
  groupId: LayerId
): ImageDocument => {
  const group = findLayerNode(document.layers, groupId)?.node;
  if (!group || group.type !== 'group' || layerId === groupId) return document;
  const layers = moveLayerNodePreservingWorld(
    document.layers,
    layerId,
    groupId,
    group.children.length
  );
  return layers === document.layers ? document : updateDocument(document, layers);
};

export const moveLayerSelection = (
  document: ImageDocument,
  layerIds: readonly LayerId[],
  targetLayerId: LayerId,
  placement: 'above' | 'below' | 'inside'
): ImageDocument => {
  const entries = normalizedSelectionEntries(document, layerIds);
  if (!entries.length || entries.some(({ node }) => node.id === targetLayerId)) return document;
  const parentId = entries[0].parentId;
  if (entries.some((entry) => entry.parentId !== parentId)) return document;
  const selectedNodes = new Set(entries.map(({ node }) => node.id));
  const targetBefore = findLayerNode(document.layers, targetLayerId);
  if (!targetBefore) return document;
  if (entries.some(({ node }) =>
    node.type === 'group' && Boolean(findLayerNode(node.children, targetLayerId))
  )) return document;

  const sourceSiblings = siblingLayers(document, entries[0].node.id);
  const ordered = sourceSiblings.filter((node) => selectedNodes.has(node.id));
  let layers = document.layers;
  for (const node of ordered) layers = removeLayerNode(layers, node.id).nodes;

  const target = findLayerNode(layers, targetLayerId);
  if (!target) return document;
  let destinationParentId: LayerId | null;
  let insertionIndex: number;
  if (placement === 'inside') {
    if (target.node.type !== 'group') return document;
    destinationParentId = target.node.id;
    insertionIndex = target.node.children.length;
  } else {
    destinationParentId = target.parentId;
    const targetSiblings = destinationParentId === null
      ? layers
      : findLayerNode(layers, destinationParentId)?.node;
    const siblings = Array.isArray(targetSiblings)
      ? targetSiblings
      : targetSiblings?.type === 'group' ? targetSiblings.children : [];
    const targetIndex = siblings.findIndex((node) => node.id === targetLayerId);
    if (targetIndex < 0) return document;
    insertionIndex = targetIndex + (placement === 'above' ? 1 : 0);
  }
  const transforms = buildSceneTransformIndex(document);
  const destinationWorld = destinationParentId
    ? transforms.get(destinationParentId)?.localToDocument ?? null
    : identityAffineMatrix();
  if (!destinationWorld) return document;
  const preparedNodes = ordered.map((node) => {
    if (parentId === destinationParentId) return node;
    const sourceWorld = transforms.get(node.id)?.localToDocument;
    const transform = sourceWorld
      ? localTransformForReparent(sourceWorld, destinationWorld)
      : null;
    if (!transform) return null;
    return affineMatrixEquals(node.transform, transform) ? node : {
      ...node,
      transform,
      geometryRevision: node.geometryRevision + 1,
      revision: node.revision + 1,
      modifiedAt: Date.now()
    };
  });
  if (preparedNodes.some((node) => !node)) return document;
  for (const node of preparedNodes) {
    if (!node) continue;
    layers = insertLayerNode(layers, node, destinationParentId, insertionIndex);
    insertionIndex += 1;
  }
  return updateDocument(document, layers, document.activeLayerId);
};

export const groupLayers = (
  document: ImageDocument,
  layerIds: readonly LayerId[],
  name = 'Group'
): ImageDocument => {
  const entries = normalizedSelectionEntries(document, layerIds);
  if (!entries.length) return document;
  const parentId = entries[0].parentId;
  if (entries.some((entry) => entry.parentId !== parentId)) return document;
  const selected = new Set(entries.map(({ node }) => node.id));
  const siblings = siblingLayers(document, entries[0].node.id);
  const children = siblings.filter((node) => selected.has(node.id));
  if (!children.length) return document;
  const insertionIndex = Math.min(...entries.map((entry) => entry.path[entry.path.length - 1]));
  let layers = document.layers;
  for (const child of children) layers = removeLayerNode(layers, child.id).nodes;
  const group = createGroupLayerNode(name);
  group.children = children;
  layers = insertLayerNode(layers, group, parentId, insertionIndex);
  return updateDocument(document, layers, group.id);
};

export const ungroupLayers = (
  document: ImageDocument,
  layerIds: readonly LayerId[]
): ImageDocument => {
  const groups = normalizedSelectionEntries(document, layerIds)
    .filter((entry) => entry.node.type === 'group')
    .sort((left, right) => right.path.length - left.path.length);
  if (!groups.length) return document;
  let layers = document.layers;
  let activeLayerId = document.activeLayerId;
  for (const groupEntry of groups) {
    const current = findLayerNode(layers, groupEntry.node.id);
    if (!current || current.node.type !== 'group') continue;
    const index = current.path[current.path.length - 1];
    const removed = removeLayerNode(layers, current.node.id);
    layers = removed.nodes;
    current.node.children.forEach((child, childIndex) => {
      const transform = multiplyMatrices(current.node.transform, child.transform);
      const prepared = affineMatrixEquals(child.transform, transform) ? child : {
        ...child,
        transform,
        geometryRevision: child.geometryRevision + 1,
        revision: child.revision + 1,
        modifiedAt: Date.now()
      };
      layers = insertLayerNode(layers, prepared, current.parentId, index + childIndex);
    });
    if (activeLayerId === current.node.id) {
      activeLayerId = current.node.children[current.node.children.length - 1]?.id ?? null;
    }
  }
  return updateDocument(document, layers, activeLayerId);
};

export const setActiveLayer = (document: ImageDocument, layerId: LayerId | null): ImageDocument => {
  if (document.activeLayerId === layerId) return document;
  if (layerId && !findLayerNode(document.layers, layerId)) return document;
  return { ...document, activeLayerId: layerId };
};

export const markLayerPixelsChanged = (document: ImageDocument, layerId: LayerId, dirtyBounds: Rect) =>
  updateLayer(document, layerId, (layer) => layer.type !== 'raster' ? layer : ({
    ...layer,
    pixelRevision: layer.pixelRevision + 1,
    revision: layer.revision + 1,
    modifiedAt: Date.now(),
    dirtyBounds
  }));
