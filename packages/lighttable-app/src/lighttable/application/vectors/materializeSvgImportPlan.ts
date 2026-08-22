import { cloneVectorElement, identityAffineMatrix, translationMatrix } from '@lighttable/vector-core';
import type { SvgImportPlan, SvgSceneNode } from '@lighttable/vector-svg';
import {
  createGroupLayer as createGroupLayerNode,
  createVectorLayer as createVectorLayerNode,
  type GroupLayer,
  type ImageDocument,
  type LayerId,
  type VectorLayer
} from '../../editor/document/documentTypes';
import {
  insertVectorLayerTree,
  type VectorLayerTreeNode
} from '../../editor/document/documentCommands';

const materializeNodes = (
  nodes: readonly SvgSceneNode[],
  vectorName: string
): VectorLayerTreeNode[] => {
  const result: VectorLayerTreeNode[] = [];
  let pending: SvgSceneNode[] = [];
  const flush = () => {
    const elements = pending.flatMap(node => node.kind === 'element' ? [node.element] : []);
    pending = [];
    if (elements.length) result.push(createVectorLayerNode(elements, vectorName));
  };
  for (const node of nodes) {
    if (node.kind === 'element') {
      pending.push(node);
      continue;
    }
    flush();
    const children = materializeNodes(node.children, node.name || vectorName);
    if (!children.length) continue;
    if (node.clipPath) {
      const vectorClip = {
        id: node.clipPath.id,
        name: node.clipPath.name,
        enabled: true,
        inverted: false,
        elements: node.clipPath.elements.map(cloneVectorElement),
        revision: 0
      };
      if (children.length === 1 && children[0]?.type === 'vector') {
        children[0].vectorClip = vectorClip;
      }
    }
    const group = createGroupLayerNode(node.name || 'SVG Group');
    group.opacity = node.opacity;
    group.transform = { ...node.transform };
    group.compositing = 'isolated';
    group.children = children;
    if (node.clipPath && (children.length !== 1 || children[0]?.type !== 'vector')) {
      group.vectorClip = {
        id: node.clipPath.id,
        name: node.clipPath.name,
        enabled: true,
        inverted: false,
        elements: node.clipPath.elements.map(cloneVectorElement),
        revision: 0
      };
    }
    result.push(group);
  }
  flush();
  return result;
};

export interface MaterializedSvgImport {
  readonly document: ImageDocument;
  readonly layerId: LayerId;
  readonly elementIds: readonly string[];
}

/** Maps the neutral SVG paint tree into existing canonical document nodes. */
export const materializeSvgImportPlan = (
  document: ImageDocument,
  plan: SvgImportPlan,
  name: string,
  placement: { readonly x?: number; readonly y?: number } = {}
): MaterializedSvgImport => {
  const children = materializeNodes(plan.nodes, name);
  if (!children.length) throw new Error('SVG import produced no native vector layers.');
  let root: VectorLayerTreeNode;
  if (children.length === 1 && children[0]?.type === 'vector') {
    root = children[0] as VectorLayer;
    root.name = name;
  } else {
    const group = createGroupLayerNode(name) as GroupLayer;
    group.compositing = 'pass-through';
    group.children = children;
    root = group;
  }
  const x = placement.x ?? 0; const y = placement.y ?? 0;
  root.transform = x || y ? translationMatrix(x, y) : identityAffineMatrix();
  const after = insertVectorLayerTree(document, root);
  return { document: after, layerId: root.id, elementIds: plan.elements.map(({ id }) => id) };
};
