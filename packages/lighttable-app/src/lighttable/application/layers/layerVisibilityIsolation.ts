import type { ImageDocument, LayerId, LayerNode } from '../../editor/document/documentTypes';
import { walkLayerTree } from '../../editor/document/layerTree';

export interface LayerVisibilityChange {
  readonly layerIds: readonly LayerId[];
  readonly visible: boolean;
}

export interface LayerVisibilitySnapshot {
  readonly documentId: ImageDocument['id'];
  readonly targetLayerId: LayerId;
  readonly states: readonly { readonly layerId: LayerId; readonly visible: boolean }[];
}

const groupChanges = (
  document: ImageDocument,
  desired: ReadonlyMap<LayerId, boolean>
): LayerVisibilityChange[] => {
  const visible: LayerId[] = [];
  const hidden: LayerId[] = [];
  for (const { node } of walkLayerTree(document.layers)) {
    const next = desired.get(node.id);
    if (next === undefined || next === node.visible) continue;
    (next ? visible : hidden).push(node.id);
  }
  return [
    ...(visible.length ? [{ layerIds: visible, visible: true }] : []),
    ...(hidden.length ? [{ layerIds: hidden, visible: false }] : [])
  ];
};

const findLayerPath = (
  nodes: readonly LayerNode[],
  targetLayerId: LayerId,
  path: readonly LayerNode[] = []
): readonly LayerNode[] | null => {
  for (const node of nodes) {
    const nextPath = [...path, node];
    if (node.id === targetLayerId) return nextPath;
    if (node.type === 'group') {
      const childPath = findLayerPath(node.children, targetLayerId, nextPath);
      if (childPath) return childPath;
    }
  }
  return null;
};

const soloVisibilityStates = (
  document: ImageDocument,
  snapshot: LayerVisibilitySnapshot
): ReadonlyMap<LayerId, boolean> | null => {
  const path = findLayerPath(document.layers, snapshot.targetLayerId);
  if (!path) return null;
  const desired = new Map(snapshot.states.map(({ layerId, visible }) => [layerId, visible]));
  let siblings: readonly LayerNode[] = document.layers;
  path.forEach((target) => {
    siblings.forEach((node) => desired.set(node.id, node.id === target.id));
    if (target.type === 'group') siblings = target.children;
  });
  return desired;
};

export const captureLayerVisibility = (
  document: ImageDocument,
  targetLayerId: LayerId
): LayerVisibilitySnapshot => ({
  documentId: document.id,
  targetLayerId,
  states: walkLayerTree(document.layers).map(({ node }) => ({
    layerId: node.id,
    visible: node.visible
  }))
});

export const canRestoreLayerVisibility = (
  document: ImageDocument,
  snapshot: LayerVisibilitySnapshot
): boolean => {
  if (snapshot.documentId !== document.id) return false;
  const currentIds = new Set(walkLayerTree(document.layers).map(({ node }) => node.id));
  if (snapshot.states.length !== currentIds.size
    || snapshot.states.some(({ layerId }) => !currentIds.has(layerId))) return false;
  const desired = soloVisibilityStates(document, snapshot);
  return desired !== null && walkLayerTree(document.layers).every(({ node }) =>
    desired.get(node.id) === node.visible);
};

/** Hides competing branches while preserving every hidden branch's child flags. */
export const planSoloLayerVisibility = (
  document: ImageDocument,
  targetLayerId: LayerId
): LayerVisibilityChange[] => {
  const path = findLayerPath(document.layers, targetLayerId);
  if (!path) return [];
  const desired = new Map<LayerId, boolean>();
  let siblings: readonly LayerNode[] = document.layers;
  path.forEach((target) => {
    siblings.forEach((node) => desired.set(node.id, node.id === target.id));
    if (target.type === 'group') siblings = target.children;
  });
  return groupChanges(document, desired);
};

export const planRestoreLayerVisibility = (
  document: ImageDocument,
  snapshot: LayerVisibilitySnapshot
): LayerVisibilityChange[] => canRestoreLayerVisibility(document, snapshot)
  ? groupChanges(document, new Map(snapshot.states.map(({ layerId, visible }) => [layerId, visible])))
  : [];

export const planAllLayerVisibility = (
  document: ImageDocument,
  visible: boolean,
  exceptLayerId?: LayerId
): LayerVisibilityChange[] => groupChanges(document, new Map(
  walkLayerTree(document.layers)
    .filter(({ node }) => node.id !== exceptLayerId)
    .map(({ node }) => [node.id, visible])
));
