import type { ImageDocument, LayerId } from '../../../editor/document/documentTypes';
import { setLayerTransform } from '../../../editor/document/documentCommands';
import { walkLayerTree } from '../../../editor/document/layerTree';
import { buildSceneTransformIndex } from '../../../editor/document/sceneTransformGraph';
import { invertMatrix, multiplyMatrices, type AffineMatrix } from '../../../editor/geometry/affine';

/**
 * Removes selected descendants when one of their ancestor groups is selected.
 * Transforming both would apply the document-space delta twice to the child.
 */
export const topLevelTransformLayerIds = (
  document: ImageDocument,
  layerIds: readonly LayerId[]
): LayerId[] => {
  const selected = new Set(layerIds);
  const parentById = new Map(
    walkLayerTree(document.layers).map(({ node, parentId }) => [node.id, parentId] as const)
  );
  return [...selected].filter((layerId) => {
    let parentId = parentById.get(layerId) ?? null;
    while (parentId) {
      if (selected.has(parentId)) return false;
      parentId = parentById.get(parentId) ?? null;
    }
    return parentById.has(layerId);
  });
};

/** Applies one document-space delta to every selected layer exactly once. */
export const transformLayerGroupInDocumentSpace = (
  document: ImageDocument,
  layerIds: readonly LayerId[],
  delta: AffineMatrix
): ImageDocument => {
  const scene = buildSceneTransformIndex(document);
  let next = document;
  for (const layerId of topLevelTransformLayerIds(document, layerIds)) {
    const resolved = scene.get(layerId);
    if (!resolved) continue;
    const parentToDocument = resolved.parentId
      ? scene.get(resolved.parentId)?.localToDocument
      : { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
    const documentToParent = parentToDocument ? invertMatrix(parentToDocument) : null;
    if (!documentToParent) continue;
    next = setLayerTransform(next, layerId, multiplyMatrices(
      documentToParent,
      multiplyMatrices(delta, resolved.localToDocument)
    ));
  }
  return next;
};
