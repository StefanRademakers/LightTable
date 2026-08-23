import type {
  ImageDocument,
  LayerId,
  LayerNode,
  RasterLayer,
  Rect
} from '../../../editor/document/documentTypes';
import { setLayerTransform } from '../../../editor/document/documentCommands';
import { walkLayerTree } from '../../../editor/document/layerTree';
import { buildSceneTransformIndex } from '../../../editor/document/sceneTransformGraph';
import {
  invertMatrix,
  multiplyMatrices,
  transformedBounds,
  type AffineMatrix
} from '../../../editor/geometry/affine';
import type { SelectionCoverageBounds } from '../../../editor/selection/selectionCoverage';

export interface TransformGroupBoundsMeasurer {
  measureLayerContent(layer: RasterLayer): Promise<SelectionCoverageBounds | null>;
  measureSemanticLayerContent(layer: LayerNode): Promise<SelectionCoverageBounds | null>;
}

const unionRects = (rects: readonly Rect[]): Rect | null => {
  if (!rects.length) return null;
  const left = Math.min(...rects.map(({ x }) => x));
  const top = Math.min(...rects.map(({ y }) => y));
  const right = Math.max(...rects.map(({ x, width }) => x + width));
  const bottom = Math.max(...rects.map(({ y, height }) => y + height));
  return { x: left, y: top, width: right - left, height: bottom - top };
};

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

/** Measures the actual painted union for a multi-layer transform cage. */
export const measureTransformGroupBounds = async (
  document: ImageDocument,
  layerIds: readonly LayerId[],
  measurer: TransformGroupBoundsMeasurer
): Promise<Rect | null> => {
  const scene = buildSceneTransformIndex(document);
  const byId = new Map(walkLayerTree(document.layers).map(({ node }) => [node.id, node]));
  const measureNode = async (node: LayerNode): Promise<Rect[]> => {
    if (node.type === 'adjustment') return [];
    if (node.type === 'group') {
      return (await Promise.all(node.children.map(measureNode))).flat();
    }
    const measured = node.type === 'raster'
      ? await measurer.measureLayerContent(node)
      : await measurer.measureSemanticLayerContent(node);
    const resolved = scene.get(node.id);
    if (!measured || !resolved) return [];
    return [transformedBounds(resolved.localToDocument, measured.coreBounds)];
  };
  const roots = topLevelTransformLayerIds(document, layerIds)
    .map((layerId) => byId.get(layerId))
    .filter((node): node is LayerNode => Boolean(node));
  return unionRects((await Promise.all(roots.map(measureNode))).flat());
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
