import {
  cloneVectorElement,
  cloneVectorPath,
  hitTestVectorPath,
  identityAffineMatrix,
  pathBounds,
  realizeLiveShape,
  transformPoint,
  unionRects,
  type PathHitTestOptions,
  type PathSelectionTarget,
  type Rect as VectorRect,
  type Vec2,
  type VectorElement,
  type VectorPath
} from '@lighttable/vector-core';
import type {
  ImageDocument,
  LayerId,
  LayerNode,
  VectorLayer
} from '../../editor/document/documentTypes';
import {
  buildSceneTransformIndex,
  requireSceneTransform
} from '../../editor/document/sceneTransformGraph';
import { multiplyMatrices } from '../../editor/geometry/affine';

export interface ResolvedVectorPath {
  layerId: LayerId;
  pathId: string;
  layer: VectorLayer;
  /** Maps layer-local coordinates into document space. */
  layerToDocument: VectorPath['transform'];
  /**
   * Read-only query projection whose transform maps path-local coordinates
   * directly into document space. Persisted path data is never modified.
   */
  documentPath: VectorPath;
}

export interface ResolvedVectorElement {
  layerId: LayerId;
  elementId: string;
  layer: VectorLayer;
  element: VectorElement;
  /** Maps layer-local coordinates into document space. */
  layerToDocument: VectorPath['transform'];
  /** Disposable canonical path used only for geometry queries. */
  documentPath: VectorPath;
}

export interface VectorDocumentElementHit extends ResolvedVectorElement {
  target: PathSelectionTarget;
}

export interface VectorDocumentHit extends ResolvedVectorPath {
  target: PathSelectionTarget;
}

export interface VectorDocumentAnchor {
  layerId: LayerId;
  pathId: string;
  subpathId: string;
  anchorId: string;
  documentPoint: Vec2;
}

const visibleVectorLayersTopmostFirst = (
  nodes: readonly LayerNode[],
  ancestorsVisible = true
): VectorLayer[] => {
  const result: VectorLayer[] = [];
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    const visible = ancestorsVisible && node.visible;
    if (!visible) continue;
    if (node.type === 'group') {
      result.push(...visibleVectorLayersTopmostFirst(node.children, visible));
    } else if (node.type === 'vector') {
      result.push(node);
    }
  }
  return result;
};

/**
 * Resolves visible vector artwork in visual hit-test order.
 *
 * Layer and group arrays are stored bottom-most first, as are paths within a
 * vector layer. Queries deliberately reverse both levels so the first match
 * is the same artwork a user sees on top.
 */
export const vectorPathsTopmostFirst = (
  document: Pick<ImageDocument, 'layers'>
): ResolvedVectorPath[] => {
  const transforms = buildSceneTransformIndex(document);
  return visibleVectorLayersTopmostFirst(document.layers).flatMap((layer) => {
    const layerToDocument = requireSceneTransform(transforms, layer.id).localToDocument;
    return layer.elements
      .filter((element): element is VectorPath => element.type === 'path')
      .reverse()
      .map((path) => ({
        layerId: layer.id,
        pathId: path.id,
        layer,
        layerToDocument,
        documentPath: {
          ...cloneVectorPath(path),
          transform: multiplyMatrices(layerToDocument, path.transform)
        }
      }));
  });
};

/** Resolves paths and parametric live shapes in visual hit-test order. */
export const vectorElementsTopmostFirst = (
  document: Pick<ImageDocument, 'layers'>
): ResolvedVectorElement[] => {
  const transforms = buildSceneTransformIndex(document);
  return visibleVectorLayersTopmostFirst(document.layers).flatMap((layer) => {
    const layerToDocument = requireSceneTransform(transforms, layer.id).localToDocument;
    return [...layer.elements]
      .reverse()
      .map((element) => {
        const queryPath = element.type === 'path'
          ? cloneVectorPath(element)
          : realizeLiveShape(element);
        queryPath.transform = multiplyMatrices(layerToDocument, queryPath.transform);
        return {
          layerId: layer.id,
          elementId: element.id,
          layer,
          layerToDocument,
          element: cloneVectorElement(element),
          documentPath: queryPath
        };
      });
  });
};

export const hitTestVectorElementDocument = (
  document: Pick<ImageDocument, 'layers'>,
  options: PathHitTestOptions
): VectorDocumentElementHit | null => {
  for (const resolved of vectorElementsTopmostFirst(document)) {
    const target = hitTestVectorPath(resolved.documentPath, options);
    if (target) return { ...resolved, target };
  }
  return null;
};

export const hitTestVectorDocument = (
  document: Pick<ImageDocument, 'layers'>,
  options: PathHitTestOptions
): VectorDocumentHit | null => {
  for (const resolved of vectorPathsTopmostFirst(document)) {
    const target = hitTestVectorPath(resolved.documentPath, options);
    if (target) return { ...resolved, target };
  }
  return null;
};

const normalizedRect = (rect: VectorRect): VectorRect => ({
  x: Math.min(rect.x, rect.x + rect.width),
  y: Math.min(rect.y, rect.y + rect.height),
  width: Math.abs(rect.width),
  height: Math.abs(rect.height)
});

/** Returns visible anchors contained by a document-space marquee. */
export const vectorAnchorsInDocumentRect = (
  document: Pick<ImageDocument, 'layers'>,
  rect: VectorRect
): VectorDocumentAnchor[] => {
  const bounds = normalizedRect(rect);
  const maxX = bounds.x + bounds.width;
  const maxY = bounds.y + bounds.height;
  return vectorPathsTopmostFirst(document).flatMap((resolved) =>
    resolved.documentPath.subpaths.flatMap((subpath) =>
      subpath.anchors.flatMap((anchor) => {
        const documentPoint = transformPoint(resolved.documentPath.transform, anchor.position);
        return documentPoint.x >= bounds.x && documentPoint.x <= maxX
          && documentPoint.y >= bounds.y && documentPoint.y <= maxY
          ? [{
              layerId: resolved.layerId,
              pathId: resolved.pathId,
              subpathId: subpath.id,
              anchorId: anchor.id,
              documentPoint
            }]
          : [];
      })
    )
  );
};

const bakeDocumentTransform = (path: VectorPath): VectorPath => ({
  ...cloneVectorPath(path),
  transform: identityAffineMatrix(),
  subpaths: path.subpaths.map((subpath) => ({
    ...subpath,
    anchors: subpath.anchors.map((anchor) => ({
      ...anchor,
      position: transformPoint(path.transform, anchor.position),
      handleIn: anchor.handleIn ? transformPoint(path.transform, anchor.handleIn) : null,
      handleOut: anchor.handleOut ? transformPoint(path.transform, anchor.handleOut) : null
    }))
  }))
});

/** Exact cubic geometry bounds in document space (excluding stroke width). */
export const vectorPathDocumentBounds = (
  document: Pick<ImageDocument, 'layers'>,
  layerId: LayerId,
  pathId: string
): VectorRect | null => {
  const resolved = vectorPathsTopmostFirst(document).find(
    (entry) => entry.layerId === layerId && entry.pathId === pathId
  );
  return resolved ? pathBounds(bakeDocumentTransform(resolved.documentPath)) : null;
};


/** Exact document-space geometry bounds for a path or parametric live shape. */
export const vectorElementDocumentBounds = (
  document: Pick<ImageDocument, 'layers'>,
  layerId: LayerId,
  elementId: string
): VectorRect | null => {
  const resolved = vectorElementsTopmostFirst(document).find(
    (entry) => entry.layerId === layerId && entry.elementId === elementId
  );
  return resolved ? pathBounds(bakeDocumentTransform(resolved.documentPath)) : null;
};

/** Exact union of selected element geometry in document space. */
export const vectorElementsDocumentBounds = (
  document: Pick<ImageDocument, 'layers'>,
  references: readonly { layerId: LayerId; elementId: string }[]
): VectorRect | null => {
  if (!references.length) return null;
  const selected = new Set(references.map(({ layerId, elementId }) => `${layerId}\u0000${elementId}`));
  return vectorElementsTopmostFirst(document).reduce<VectorRect | null>(
    (bounds, resolved) => selected.has(`${resolved.layerId}\u0000${resolved.elementId}`)
      ? unionRects(bounds, pathBounds(bakeDocumentTransform(resolved.documentPath)))
      : bounds,
    null
  );
};
