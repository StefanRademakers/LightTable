import type { AffineMatrix, TransformPoint } from '../geometry/affine';
import {
  identityAffineMatrix,
  invertMatrix,
  multiplyMatrices,
  transformPoint
} from '../geometry/affine';
import type { ImageDocument, LayerId, LayerNode } from './documentTypes';

/**
 * Derived transform data for one node in the document scene graph.
 * Persisted nodes own only `localToParent`; all other matrices are derived.
 */
export interface ResolvedSceneTransform {
  layerId: LayerId;
  parentId: LayerId | null;
  localToParent: AffineMatrix;
  localToDocument: AffineMatrix;
  documentToLocal: AffineMatrix | null;
  depth: number;
}

export type SceneTransformIndex = ReadonlyMap<LayerId, ResolvedSceneTransform>;

/**
 * Resolves every persisted local transform into document space.
 *
 * Matrix order is intentionally explicit: parent world * child local. This is
 * the only ordering engine systems should use for layer hierarchy transforms.
 */
export const buildSceneTransformIndex = (
  document: Pick<ImageDocument, 'layers'>
): SceneTransformIndex => {
  const result = new Map<LayerId, ResolvedSceneTransform>();

  const visit = (
    nodes: readonly LayerNode[],
    parentId: LayerId | null,
    parentToDocument: AffineMatrix,
    depth: number
  ) => {
    for (const node of nodes) {
      const localToDocument = multiplyMatrices(parentToDocument, node.transform);
      result.set(node.id, {
        layerId: node.id,
        parentId,
        localToParent: node.transform,
        localToDocument,
        documentToLocal: invertMatrix(localToDocument),
        depth
      });
      if (node.type === 'group') {
        visit(node.children, node.id, localToDocument, depth + 1);
      }
    }
  };

  visit(document.layers, null, identityAffineMatrix(), 0);
  return result;
};

export const requireSceneTransform = (
  index: SceneTransformIndex,
  layerId: LayerId
): ResolvedSceneTransform => {
  const resolved = index.get(layerId);
  if (!resolved) throw new Error(`Scene transform is unavailable for layer ${layerId}.`);
  return resolved;
};

export const localPointToDocument = (
  resolved: ResolvedSceneTransform,
  point: TransformPoint
) => transformPoint(resolved.localToDocument, point);

export const documentPointToLocal = (
  resolved: ResolvedSceneTransform,
  point: TransformPoint
): TransformPoint | null => resolved.documentToLocal
  ? transformPoint(resolved.documentToLocal, point)
  : null;

/**
 * Computes a new local matrix when moving a node to another parent while
 * preserving its exact document-space appearance.
 */
export const localTransformForReparent = (
  currentLocalToDocument: AffineMatrix,
  newParentToDocument: AffineMatrix
): AffineMatrix | null => {
  const documentToNewParent = invertMatrix(newParentToDocument);
  return documentToNewParent
    ? multiplyMatrices(documentToNewParent, currentLocalToDocument)
    : null;
};
